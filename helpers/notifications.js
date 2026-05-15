const { getDb } = require('../config/database');
const sse = require('./sseManager');

function getAdminIds() {
  return getDb()
    .prepare("SELECT id FROM users WHERE role IN ('admin', 'supervisor') AND is_active = 1")
    .all().map(u => u.id);
}

// Kirim notifikasi ke banyak user sekaligus, kecualikan actor
function notify(userIds, ticketId, type, message, exceptUserId) {
  const db = getDb();
  const unique = [...new Set(userIds)].filter(id => id && id !== exceptUserId);
  if (unique.length === 0) return;

  const insert = db.prepare(
    'INSERT INTO notifications (user_id, ticket_id, type, message) VALUES (?,?,?,?)'
  );
  const countStmt = db.prepare(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
  );

  db.transaction(() => {
    unique.forEach(uid => insert.run(uid, ticketId, type, message));
  })();

  // Push realtime ke client yang sedang online
  unique.forEach(uid => {
    const count = countStmt.get(uid).c;
    sse.pushToUser(uid, { type, message, ticket_id: ticketId, count });
  });
}

// ── Helpers per event ────────────────────────────────────────────

function onTicketCreated(ticket, creatorName) {
  notify(
    getAdminIds(),
    ticket.id,
    'ticket_created',
    `Tiket baru <strong>${ticket.ticket_number}</strong> dibuat oleh ${creatorName}: ${ticket.title}`,
    null // tetap notif admin meskipun admin yang buat
  );
}

function onTicketAssigned(ticket, technicianId, technicianName, actorId) {
  const db = getDb();
  const recipients = new Set(getAdminIds());

  // Beritahu teknisi yang ditugaskan
  if (technicianId) {
    notify(
      [technicianId],
      ticket.id,
      'ticket_assigned',
      `Anda ditugaskan pada tiket <strong>${ticket.ticket_number}</strong>: ${ticket.title}`,
      null
    );
    recipients.delete(technicianId);
  }

  // Beritahu pembuat tiket
  notify(
    [ticket.created_by],
    ticket.id,
    'ticket_assigned',
    technicianId
      ? `Tiket <strong>${ticket.ticket_number}</strong> Anda telah ditugaskan ke ${technicianName}`
      : `Penugasan tiket <strong>${ticket.ticket_number}</strong> Anda telah dihapus`,
    actorId
  );
}

function onCommentAdded(ticket, commenterName, actorId) {
  const recipients = [
    ticket.created_by,
    ticket.assigned_to,
    ...getAdminIds()
  ];
  notify(
    recipients,
    ticket.id,
    'comment_added',
    `${commenterName} menambahkan komentar pada tiket <strong>${ticket.ticket_number}</strong>`,
    actorId
  );
}

function onStatusChanged(ticket, newStatus, changerName, actorId) {
  const statusLabel = {
    open: 'Open', assigned: 'Assigned',
    in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed'
  }[newStatus] || newStatus;

  const recipients = [
    ticket.created_by,
    ticket.assigned_to,
    ...getAdminIds()
  ];
  notify(
    recipients,
    ticket.id,
    'status_changed',
    `${changerName} mengubah status tiket <strong>${ticket.ticket_number}</strong> menjadi <em>${statusLabel}</em>`,
    actorId
  );
}

function onAttachmentAdded(ticket, uploaderName, fileCount, actorId) {
  const recipients = [
    ticket.created_by,
    ticket.assigned_to,
    ...getAdminIds()
  ];
  notify(
    recipients,
    ticket.id,
    'attachment_added',
    `${uploaderName} mengupload ${fileCount} file pada tiket <strong>${ticket.ticket_number}</strong>`,
    actorId
  );
}

module.exports = {
  onTicketCreated,
  onTicketAssigned,
  onCommentAdded,
  onStatusChanged,
  onAttachmentAdded
};
