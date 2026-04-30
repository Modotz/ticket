const { getDb } = require('../config/database');
const sse = require('../helpers/sseManager');

exports.index = (req, res) => {
  const db = getDb();
  const userId = req.session.user.id;

  // Tandai semua sebagai sudah dibaca saat buka halaman
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);

  const notifications = db.prepare(`
    SELECT n.*, t.ticket_number
    FROM notifications n
    LEFT JOIN tickets t ON n.ticket_id = t.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 100
  `).all(userId);

  res.render('notifications/index', { title: 'Notifikasi', notifications });
};

exports.markRead = (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  // Redirect ke tiket terkait jika ada
  const notif = db.prepare('SELECT ticket_id FROM notifications WHERE id = ?').get(req.params.id);
  if (notif?.ticket_id) {
    return res.redirect(`/tickets/${notif.ticket_id}`);
  }
  res.redirect('/notifications');
};

exports.markAllRead = (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  req.flash('success', 'Semua notifikasi ditandai sudah dibaca');
  res.redirect('/notifications');
};

// JSON endpoint untuk refresh dropdown via AJAX
exports.recent = (req, res) => {
  const db = getDb();
  const uid = req.session.user.id;
  const notifications = db.prepare(`
    SELECT n.*, t.ticket_number
    FROM notifications n
    LEFT JOIN tickets t ON n.ticket_id = t.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT 8
  `).all(uid);
  const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(uid).c;
  res.json({ notifications, count });
};

exports.deleteAll = (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.session.user.id);
  req.flash('success', 'Semua notifikasi dihapus');
  res.redirect('/notifications');
};

// SSE stream — satu koneksi persisten per tab browser
exports.stream = (req, res) => {
  const userId = req.session.user.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // matikan buffering nginx jika ada
  res.flushHeaders();

  // Konfirmasi koneksi berhasil
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  sse.addClient(userId, res);

  // Heartbeat tiap 25 detik agar koneksi tidak di-timeout proxy/browser
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(userId, res);
  });
};
