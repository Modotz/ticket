const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');

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

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.flash('error', 'Username atau password salah');
    return res.redirect('/auth/login');
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role
  };

  req.flash('success', `Selamat datang, ${user.name}!`);
  res.redirect('/');
};

exports.logout = (req, res) => {
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

  if (new_password.length < 6) {
    req.flash('error', 'Password baru minimal 6 karakter');
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

  req.flash('success', 'Password berhasil diubah. Silakan login kembali.');
  req.session.destroy();
  res.redirect('/auth/login');
};
