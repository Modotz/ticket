const { getDb } = require('../config/database');
const { computeSla } = require('../helpers/sla');

exports.index = (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let stats = {};
  let recentTickets = [];

  const baseJoin = `
    SELECT t.*, u1.name as creator_name, u2.name as assignee_name,
           p.duration_value as sla_value, p.duration_unit as sla_unit
    FROM tickets t
    LEFT JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.assigned_to = u2.id
    LEFT JOIN priorities p ON p.code = t.priority
  `;

  if (user.role === 'admin') {
    stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
      open: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c,
      in_progress: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('assigned','in_progress')").get().c,
      resolved: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('resolved','closed')").get().c
    };
    recentTickets = db.prepare(baseJoin + ' ORDER BY t.created_at DESC LIMIT 10').all();

  } else if (user.role === 'reporter') {
    stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM tickets WHERE created_by = ?').get(user.id).c,
      open: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE created_by = ? AND status = 'open'").get(user.id).c,
      in_progress: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE created_by = ? AND status IN ('assigned','in_progress')").get(user.id).c,
      resolved: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE created_by = ? AND status IN ('resolved','closed')").get(user.id).c
    };
    recentTickets = db.prepare(baseJoin + ' WHERE t.created_by = ? ORDER BY t.created_at DESC LIMIT 10').all(user.id);

  } else if (user.role === 'supervisor') {
    stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
      open: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c,
      in_progress: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('assigned','in_progress')").get().c,
      resolved: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('resolved','closed')").get().c
    };
    recentTickets = db.prepare(baseJoin + ' ORDER BY t.created_at DESC LIMIT 10').all();

  } else if (user.role === 'technician') {
    stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM tickets WHERE assigned_to = ?').get(user.id).c,
      open: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assigned_to = ? AND status = 'assigned'").get(user.id).c,
      in_progress: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assigned_to = ? AND status = 'in_progress'").get(user.id).c,
      resolved: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assigned_to = ? AND status IN ('resolved','closed')").get(user.id).c
    };
    recentTickets = db.prepare(baseJoin + ' WHERE t.assigned_to = ? ORDER BY t.created_at DESC LIMIT 10').all(user.id);
  }

  recentTickets = recentTickets.map(t => ({ ...t, sla: computeSla(t) }));

  res.render('dashboard/index', { title: 'Dashboard', stats, recentTickets });
};
