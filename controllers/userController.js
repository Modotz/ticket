const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');

exports.index = (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC').all();
  res.render('users/index', { title: 'Manajemen Pengguna', users });
};

exports.createPage = (req, res) => {
  res.render('users/create', { title: 'Tambah Pengguna' });
};

exports.create = (req, res) => {
  const { username, name, email, password, role } = req.body;
  const db = getDb();

  if (!username || !name || !email || !password || !role) {
    req.flash('error', 'Semua field wajib diisi');
    return res.redirect('/users/create');
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    req.flash('error', 'Username atau email sudah digunakan');
    return res.redirect('/users/create');
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, name, email, password, role) VALUES (?,?,?,?,?)')
    .run(username, name, email, hashed, role);

  req.flash('success', `Pengguna ${name} berhasil ditambahkan`);
  res.redirect('/users');
};

exports.editPage = (req, res) => {
  const db = getDb();
  const editUser = db.prepare('SELECT id, username, name, email, role, is_active FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) {
    req.flash('error', 'Pengguna tidak ditemukan');
    return res.redirect('/users');
  }
  res.render('users/edit', { title: 'Edit Pengguna', editUser });
};

exports.update = (req, res) => {
  const { name, email, role, is_active, password } = req.body;
  const db = getDb();

  if (password && password.trim()) {
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password=? WHERE id=?')
      .run(name, email, role, is_active ? 1 : 0, hashed, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=? WHERE id=?')
      .run(name, email, role, is_active ? 1 : 0, req.params.id);
  }

  req.flash('success', 'Data pengguna berhasil diperbarui');
  res.redirect('/users');
};

exports.deleteUser = (req, res) => {
  const db = getDb();
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'Tidak dapat menonaktifkan akun sendiri');
    return res.redirect('/users');
  }
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  req.flash('success', 'Pengguna berhasil dinonaktifkan');
  res.redirect('/users');
};
