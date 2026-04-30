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
