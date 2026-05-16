const { getDb } = require('../config/database');

exports.index = (req, res) => {
  const db = getDb();
  const { action, q, date_from, date_to } = req.query;

  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const p = [];
  if (action) { sql += ' AND action = ?'; p.push(action); }
  if (q) {
    sql += ' AND (user_name LIKE ? OR detail LIKE ? OR entity_id LIKE ?)';
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (date_from) { sql += ' AND date(created_at) >= date(?)'; p.push(date_from); }
  if (date_to)   { sql += ' AND date(created_at) <= date(?)'; p.push(date_to); }
  sql += ' ORDER BY id DESC LIMIT 500';

  const logs = db.prepare(sql).all(...p);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map(r => r.action);

  res.render('audit/index', {
    title: 'Audit Log',
    logs,
    actions,
    filters: { action, q, date_from, date_to }
  });
};
