const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const audit = require('../helpers/audit');
const { validatePassword } = require('../helpers/password');

// Lockout sederhana per-username (in-memory)
const attempts = new Map(); // username -> { count, until }
const MAX = parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5;
const LOCK_MS = (parseInt(process.env.LOGIN_LOCK_MIN, 10) || 15) * 60000;

function lockState(username) {
  const a = attempts.get(username);
  if (a && a.until && a.until > Date.now()) {
    return Math.ceil((a.until - Date.now()) / 60000);
  }
  return 0;
}
function recordFail(username) {
  const a = attempts.get(username) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX) { a.until = Date.now() + LOCK_MS; a.count = 0; }
  attempts.set(username, a);
}
function clearFail(username) { attempts.delete(username); }

exports.loginPage = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { layout: 'layouts/auth', title: 'Login' });
};

exports.login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.flash('error', 'Username dan password wajib diisi');
    return res.redirect('/auth/login');
  }

  const locked = lockState(username);
  if (locked > 0) {
    req.flash('error', `Akun terkunci sementara. Coba lagi dalam ${locked} menit.`);
    return res.redirect('/auth/login');
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    recordFail(username);
    audit.log(req, 'login_failed', 'auth', null, `username: ${username}`);
    req.flash('error', 'Username atau password salah');
    return res.redirect('/auth/login');
  }

  clearFail(username);
  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role
  };
  audit.log(req, 'login', 'auth', user.id, `${user.username} (${user.role})`);

  req.flash('success', `Selamat datang, ${user.name}!`);
  res.redirect('/');
};

exports.logout = (req, res) => {
  audit.log(req, 'logout', 'auth', req.session.user && req.session.user.id, null);
  req.session.destroy();
  res.redirect('/auth/login');
};

exports.changePasswordPage = (req, res) => {
  res.render('auth/change-password', { title: 'Ganti Password' });
};

exports.changePassword = (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const db = getDb();

  if (!current_password || !new_password || !confirm_password) {
    req.flash('error', 'Semua field wajib diisi');
    return res.redirect('/auth/change-password');
  }

  const pwErr = validatePassword(new_password);
  if (pwErr) {
    req.flash('error', pwErr);
    return res.redirect('/auth/change-password');
  }

  if (new_password !== confirm_password) {
    req.flash('error', 'Konfirmasi password tidak cocok');
    return res.redirect('/auth/change-password');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Password saat ini salah');
    return res.redirect('/auth/change-password');
  }

  if (bcrypt.compareSync(new_password, user.password)) {
    req.flash('error', 'Password baru tidak boleh sama dengan password lama');
    return res.redirect('/auth/change-password');
  }

  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.session.user.id);
  audit.log(req, 'password_changed', 'user', req.session.user.id, req.session.user.username);

  req.flash('success', 'Password berhasil diubah. Silakan login kembali.');
  req.session.destroy();
  res.redirect('/auth/login');
};
