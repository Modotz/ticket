const { getDb } = require('../config/database');
const audit = require('../helpers/audit');

const UNITS = ['jam', 'hari', 'minggu'];
const COLORS = ['success', 'info', 'warning', 'danger', 'primary', 'secondary', 'dark'];

function norm(req) {
  return {
    code: (req.body.code || '').trim().toLowerCase().replace(/\s+/g, '_'),
    name: (req.body.name || '').trim(),
    color: COLORS.includes(req.body.color) ? req.body.color : 'secondary',
    duration_value: Math.max(1, parseInt(req.body.duration_value, 10) || 1),
    duration_unit: UNITS.includes(req.body.duration_unit) ? req.body.duration_unit : 'hari',
    sort_order: parseInt(req.body.sort_order, 10) || 0
  };
}

exports.index = (req, res) => {
  const db = getDb();
  const priorities = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM tickets t WHERE t.priority = p.code) AS used
    FROM priorities p ORDER BY p.sort_order, p.name
  `).all();
  res.render('priorities/index', { title: 'Master Prioritas', priorities });
};

exports.createPage = (req, res) => {
  res.render('priorities/create', { title: 'Tambah Prioritas', UNITS, COLORS });
};

exports.create = (req, res) => {
  const db = getDb();
  const d = norm(req);
  if (!d.code || !d.name) {
    req.flash('error', 'Kode dan nama prioritas wajib diisi');
    return res.redirect('/priorities/create');
  }
  if (db.prepare('SELECT id FROM priorities WHERE code = ? COLLATE NOCASE').get(d.code)) {
    req.flash('error', `Kode "${d.code}" sudah ada`);
    return res.redirect('/priorities/create');
  }
  db.prepare(`INSERT INTO priorities (code,name,color,duration_value,duration_unit,sort_order,is_active)
              VALUES (?,?,?,?,?,?,1)`)
    .run(d.code, d.name, d.color, d.duration_value, d.duration_unit, d.sort_order);
  audit.log(req, 'priority_created', 'priority', d.code, `${d.name} (${d.duration_value} ${d.duration_unit})`);
  req.flash('success', `Prioritas "${d.name}" berhasil ditambahkan`);
  res.redirect('/priorities');
};

exports.editPage = (req, res) => {
  const db = getDb();
  const priority = db.prepare('SELECT * FROM priorities WHERE id = ?').get(req.params.id);
  if (!priority) {
    req.flash('error', 'Prioritas tidak ditemukan');
    return res.redirect('/priorities');
  }
  res.render('priorities/edit', { title: 'Edit Prioritas', priority, UNITS, COLORS });
};

exports.update = (req, res) => {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM priorities WHERE id = ?').get(req.params.id);
  if (!cur) {
    req.flash('error', 'Prioritas tidak ditemukan');
    return res.redirect('/priorities');
  }
  const d = norm(req);
  const isActive = req.body.is_active ? 1 : 0;
  if (!d.code || !d.name) {
    req.flash('error', 'Kode dan nama prioritas wajib diisi');
    return res.redirect(`/priorities/${req.params.id}/edit`);
  }
  const dup = db.prepare('SELECT id FROM priorities WHERE code = ? COLLATE NOCASE AND id <> ?')
    .get(d.code, req.params.id);
  if (dup) {
    req.flash('error', `Kode "${d.code}" sudah dipakai prioritas lain`);
    return res.redirect(`/priorities/${req.params.id}/edit`);
  }
  const tx = db.transaction(() => {
    if (cur.code !== d.code) {
      db.prepare('UPDATE tickets SET priority = ? WHERE priority = ?').run(d.code, cur.code);
    }
    db.prepare(`UPDATE priorities SET code=?,name=?,color=?,duration_value=?,
                duration_unit=?,sort_order=?,is_active=? WHERE id=?`)
      .run(d.code, d.name, d.color, d.duration_value, d.duration_unit, d.sort_order, isActive, req.params.id);
  });
  tx();
  audit.log(req, 'priority_updated', 'priority', d.code, `${d.name} (${d.duration_value} ${d.duration_unit})`);
  req.flash('success', 'Prioritas berhasil diperbarui');
  res.redirect('/priorities');
};

exports.remove = (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM priorities WHERE id = ?').get(req.params.id);
  if (!p) {
    req.flash('error', 'Prioritas tidak ditemukan');
    return res.redirect('/priorities');
  }
  const used = db.prepare('SELECT COUNT(*) c FROM tickets WHERE priority = ?').get(p.code).c;
  if (used > 0) {
    req.flash('error', `Tidak bisa hapus: "${p.name}" dipakai ${used} tiket. Nonaktifkan saja.`);
    return res.redirect('/priorities');
  }
  db.prepare('DELETE FROM priorities WHERE id = ?').run(req.params.id);
  audit.log(req, 'priority_deleted', 'priority', p.code, p.name);
  req.flash('success', `Prioritas "${p.name}" dihapus`);
  res.redirect('/priorities');
};
