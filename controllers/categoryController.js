const { getDb } = require('../config/database');
const audit = require('../helpers/audit');

exports.index = (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM tickets t WHERE t.category = c.name) AS used
    FROM categories c ORDER BY c.name
  `).all();
  res.render('categories/index', { title: 'Master Kategori', categories });
};

exports.createPage = (req, res) => {
  res.render('categories/create', { title: 'Tambah Kategori' });
};

exports.create = (req, res) => {
  const name = (req.body.name || '').trim();
  const db = getDb();
  if (!name) {
    req.flash('error', 'Nama kategori wajib diisi');
    return res.redirect('/categories/create');
  }
  if (db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name)) {
    req.flash('error', `Kategori "${name}" sudah ada`);
    return res.redirect('/categories/create');
  }
  const r = db.prepare('INSERT INTO categories (name, is_active) VALUES (?, 1)').run(name);
  audit.log(req, 'category_created', 'category', r.lastInsertRowid, name);
  req.flash('success', `Kategori "${name}" berhasil ditambahkan`);
  res.redirect('/categories');
};

exports.editPage = (req, res) => {
  const db = getDb();
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) {
    req.flash('error', 'Kategori tidak ditemukan');
    return res.redirect('/categories');
  }
  res.render('categories/edit', { title: 'Edit Kategori', category });
};

exports.update = (req, res) => {
  const db = getDb();
  const name = (req.body.name || '').trim();
  const isActive = req.body.is_active ? 1 : 0;
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cur) {
    req.flash('error', 'Kategori tidak ditemukan');
    return res.redirect('/categories');
  }
  if (!name) {
    req.flash('error', 'Nama kategori wajib diisi');
    return res.redirect(`/categories/${req.params.id}/edit`);
  }
  const dup = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get(name, req.params.id);
  if (dup) {
    req.flash('error', `Kategori "${name}" sudah ada`);
    return res.redirect(`/categories/${req.params.id}/edit`);
  }
  // Jaga konsistensi: rename ikut memperbarui tiket lama yang memakai nama lama
  const tx = db.transaction(() => {
    if (cur.name !== name) {
      db.prepare('UPDATE tickets SET category = ? WHERE category = ?').run(name, cur.name);
    }
    db.prepare('UPDATE categories SET name = ?, is_active = ? WHERE id = ?')
      .run(name, isActive, req.params.id);
  });
  tx();
  audit.log(req, 'category_updated', 'category', req.params.id, name);
  req.flash('success', 'Kategori berhasil diperbarui');
  res.redirect('/categories');
};

exports.remove = (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) {
    req.flash('error', 'Kategori tidak ditemukan');
    return res.redirect('/categories');
  }
  const used = db.prepare('SELECT COUNT(*) c FROM tickets WHERE category = ?').get(cat.name).c;
  if (used > 0) {
    req.flash('error', `Tidak bisa hapus: "${cat.name}" dipakai ${used} tiket. Nonaktifkan saja.`);
    return res.redirect('/categories');
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  audit.log(req, 'category_deleted', 'category', req.params.id, cat.name);
  req.flash('success', `Kategori "${cat.name}" dihapus`);
  res.redirect('/categories');
};
