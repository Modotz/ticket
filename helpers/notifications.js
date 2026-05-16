const { getDb } = require('../config/database');
const sse = require('./sseManager');
const { sendMail } = require('./mailer');
const { sendWA } = require('./whatsapp');
const { sendTelegram } = require('./telegram');

const TYPE_SUBJECT = {
  ticket_created:   'Tiket Baru',
  ticket_assigned:  'Penugasan Tiket',
  comment_added:    'Komentar Baru',
  status_changed:   'Perubahan Status Tiket',
  attachment_added: 'Lampiran Baru',
  sla_escalation:   'PERINGATAN SLA Tiket'
};

function toPlain(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

// Kirim email + WhatsApp ke penerima (async, best-effort, tak memblok).
function dispatchExternal(userIds, ticketId, type, message) {
  try {
    const db = getDb();
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const link = appUrl
      ? `${appUrl}/tickets/${ticketId || ''}`.replace(/\/$/, '')
      : '';
    const subject = `[Ticket TSJ] ${TYPE_SUBJECT[type] || 'Notifikasi'}`;
    const plain = toPlain(message);

    const rows = db.prepare(
      `SELECT email, phone, telegram_chat_id, name FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`
    ).all(...userIds);

    const waText = `*${TYPE_SUBJECT[type] || 'Notifikasi'}*\n${plain}${link ? `\n\n${link}` : ''}`;
    const tgText = `${TYPE_SUBJECT[type] || 'Notifikasi'}\n${plain}${link ? `\n\n${link}` : ''}`;

    rows.forEach(u => {
      if (u.telegram_chat_id) sendTelegram(u.telegram_chat_id, tgText);
      if (u.email) {
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
          <p>Halo ${u.name || ''},</p>
          <p>${message}</p>
          ${link ? `<p><a href="${link}" style="background:#2f5597;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">Buka Tiket</a></p>` : ''}
          <hr><small style="color:#888">Email otomatis dari Ticket TSJ.</small></div>`;
        sendMail(u.email, subject, html);
      }
      if (u.phone) sendWA(u.phone, waText);
    });
  } catch (e) {
    console.warn('[notif] dispatchExternal error:', e.message);
  }
}

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

  // Email + WhatsApp (async, tidak memblok response)
  setImmediate(() => dispatchExternal(unique, ticketId, type, message));
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

// Eskalasi SLA: beri tahu admin/teknisi tiket yang lewat tenggat.
function onSlaEscalation(ticket) {
  const recipients = [ticket.assigned_to, ...getAdminIds()];
  notify(
    recipients,
    ticket.id,
    'sla_escalation',
    `Tiket <strong>${ticket.ticket_number}</strong> <em>LEWAT SLA</em> dan belum selesai: ${ticket.title}`,
    null
  );
}

module.exports = {
  notify,
  onTicketCreated,
  onTicketAssigned,
  onCommentAdded,
  onStatusChanged,
  onAttachmentAdded,
  onSlaEscalation
};
