const { getDb } = require('../config/database');

exports.index = (req, res) => {
  const db = getDb();
  const { action, q, date_from, date_to } = req.query;

  let where = 'WHERE 1=1';
  const p = [];
  if (action) { where += ' AND action = ?'; p.push(action); }
  if (q) {
    where += ' AND (user_name LIKE ? OR detail LIKE ? OR entity_id LIKE ?)';
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (date_from) { where += ' AND date(created_at) >= date(?)'; p.push(date_from); }
  if (date_to)   { where += ' AND date(created_at) <= date(?)'; p.push(date_to); }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${where}`).get(...p).c;
  const perPage = 25;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const offset = (page - 1) * perPage;

  const logs = db.prepare(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...p, perPage, offset);

  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action')
    .all().map(r => r.action);

  res.render('audit/index', {
    title: 'Audit Log',
    logs,
    actions,
    filters: { action, q, date_from, date_to },
    pagination: { page, totalPages, total, perPage, offset }
  });
};
