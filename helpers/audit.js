const { getDb } = require('../config/database');

// Catat aktivitas ke audit_logs. Best-effort: tidak pernah memutus alur.
function log(req, action, entityType, entityId, detail) {
  try {
    const u = (req && req.session && req.session.user) || {};
    const ip = req
      ? (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().split(',')[0].trim()
      : null;
    getDb().prepare(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, detail, ip)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      u.id || null,
      u.name || u.username || 'system',
      action,
      entityType || null,
      entityId != null ? String(entityId) : null,
      detail || null,
      ip || null
    );
  } catch (e) {
    console.warn('[audit] gagal mencatat:', e.message);
  }
}

module.exports = { log };
