const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { UPLOAD_DIR, isImage, fileIcon, formatBytes } = require('../config/multer');
const notif = require('../helpers/notifications');

const CATEGORIES = ['Web Aplikasi', 'Scanner', 'Printer', 'Mobile Approval', 'Jaringan Internet', 'Lainnya'];

function generateTicketNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `TKT-${y}${m}${day}-${rand}`;
}

exports.index = (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { status, priority, search } = req.query;

  let query = `
    SELECT t.*, u1.name as creator_name, u2.name as assignee_name
    FROM tickets t
    LEFT JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.assigned_to = u2.id
    WHERE 1=1
  `;
  const params = [];

  if (user.role === 'reporter') {
    query += ' AND t.created_by = ?';
    params.push(user.id);
  } else if (user.role === 'technician') {
    query += ' AND t.assigned_to = ?';
    params.push(user.id);
  }
  // admin and supervisor see all tickets — no additional filter

  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
  if (search) {
    query += ' AND (t.title LIKE ? OR t.ticket_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY t.created_at DESC';
  const tickets = db.prepare(query).all(...params);

  res.render('tickets/index', {
    title: 'Daftar Tiket',
    tickets,
    filters: { status, priority, search }
  });
};

exports.createPage = (req, res) => {
  res.render('tickets/create', { title: 'Buat Tiket Baru', categories: CATEGORIES });
};

exports.create = (req, res) => {
  const { title, description, category, priority } = req.body;
  const db = getDb();

  if (!title || !description || !category || !priority) {
    req.flash('error', 'Semua field wajib diisi');
    return res.redirect('/tickets/create');
  }

  const ticketNumber = generateTicketNumber();
  const result = db.prepare('INSERT INTO tickets (ticket_number, title, description, category, priority, created_by) VALUES (?,?,?,?,?,?)')
    .run(ticketNumber, title, description, category, priority, req.session.user.id);

  notif.onTicketCreated(
    { id: result.lastInsertRowid, ticket_number: ticketNumber, title },
    req.session.user.name
  );

  req.flash('success', `Tiket ${ticketNumber} berhasil dibuat`);
  res.redirect('/tickets');
};

exports.show = (req, res) => {
  const db = getDb();
  const user = req.session.user;

  const ticket = db.prepare(`
    SELECT t.*, u1.name as creator_name, u1.email as creator_email,
           u2.name as assignee_name, u2.email as assignee_email
    FROM tickets t
    LEFT JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.assigned_to = u2.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!ticket) {
    req.flash('error', 'Tiket tidak ditemukan');
    return res.redirect('/tickets');
  }

  if (user.role === 'reporter' && ticket.created_by !== user.id) {
    req.flash('error', 'Anda tidak memiliki akses ke tiket ini');
    return res.redirect('/tickets');
  }
  if (user.role === 'technician' && ticket.assigned_to !== user.id) {
    req.flash('error', 'Tiket ini tidak ditugaskan kepada Anda');
    return res.redirect('/tickets');
  }
  // admin and supervisor can access any ticket

  const comments = db.prepare(`
    SELECT c.*, u.name as user_name, u.role as user_role
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `).all(ticket.id);

  const technicians = user.role === 'admin'
    ? db.prepare("SELECT id, name FROM users WHERE role = 'technician' AND is_active = 1").all()
    : [];

  const attachments = db.prepare(`
    SELECT a.*, u.name as uploader_name
    FROM attachments a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.ticket_id = ?
    ORDER BY a.created_at ASC
  `).all(ticket.id);

  res.render('tickets/show', {
    title: `Tiket ${ticket.ticket_number}`,
    ticket, comments, technicians, attachments,
    isImage, fileIcon, formatBytes
  });
};

exports.editPage = (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) {
    req.flash('error', 'Tiket tidak ditemukan');
    return res.redirect('/tickets');
  }
  res.render('tickets/edit', { title: 'Edit Tiket', ticket, categories: CATEGORIES });
};

exports.update = (req, res) => {
  const { title, description, category, priority, notes } = req.body;
  const db = getDb();
  db.prepare('UPDATE tickets SET title=?, description=?, category=?, priority=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title, description, category, priority, notes || null, req.params.id);
  req.flash('success', 'Tiket berhasil diperbarui');
  res.redirect(`/tickets/${req.params.id}`);
};

exports.assign = (req, res) => {
  const { assigned_to } = req.body;
  const db = getDb();
  const newStatus = assigned_to ? 'assigned' : 'open';

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE tickets SET assigned_to=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(assigned_to || null, newStatus, req.params.id);

  let techName = null;
  if (assigned_to) {
    const tech = db.prepare('SELECT name FROM users WHERE id = ?').get(assigned_to);
    techName = tech?.name;
  }
  notif.onTicketAssigned(
    { ...ticket, created_by: ticket.created_by },
    assigned_to ? parseInt(assigned_to) : null,
    techName,
    req.session.user.id
  );

  req.flash('success', assigned_to ? 'Tiket berhasil ditugaskan' : 'Penugasan dihapus');
  res.redirect(`/tickets/${req.params.id}`);
};

exports.updateStatus = (req, res) => {
  const { status } = req.body;
  const user = req.session.user;
  const db = getDb();

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) {
    req.flash('error', 'Tiket tidak ditemukan');
    return res.redirect('/tickets');
  }

  const allowed = {
    admin: ['open', 'assigned', 'in_progress', 'resolved', 'closed'],
    technician: ['in_progress', 'resolved'],
    reporter: ['closed']
  };

  if (!allowed[user.role]?.includes(status)) {
    req.flash('error', 'Perubahan status tidak diizinkan');
    return res.redirect(`/tickets/${req.params.id}`);
  }

  const resolvedAt = ['resolved', 'closed'].includes(status) ? new Date().toISOString() : null;
  db.prepare('UPDATE tickets SET status=?, resolved_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(status, resolvedAt, req.params.id);

  notif.onStatusChanged(ticket, status, req.session.user.name, user.id);

  req.flash('success', 'Status tiket berhasil diperbarui');
  res.redirect(`/tickets/${req.params.id}`);
};

exports.addComment = (req, res) => {
  const { comment } = req.body;
  const db = getDb();

  if (!comment?.trim()) {
    req.flash('error', 'Komentar tidak boleh kosong');
    return res.redirect(`/tickets/${req.params.id}`);
  }

  db.prepare('INSERT INTO comments (ticket_id, user_id, comment) VALUES (?,?,?)')
    .run(req.params.id, req.session.user.id, comment.trim());

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  notif.onCommentAdded(ticket, req.session.user.name, req.session.user.id);

  req.flash('success', 'Komentar berhasil ditambahkan');
  res.redirect(`/tickets/${req.params.id}`);
};

exports.deleteTicket = (req, res) => {
  const db = getDb();
  // hapus file attachment dari disk sebelum delete ticket
  const attachments = db.prepare('SELECT filename FROM attachments WHERE ticket_id = ?').all(req.params.id);
  attachments.forEach(a => {
    const fp = path.join(UPLOAD_DIR, a.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  req.flash('success', 'Tiket berhasil dihapus');
  res.redirect('/tickets');
};

exports.uploadAttachment = (req, res) => {
  const ticketId = req.params.id;

  if (!req.files || req.files.length === 0) {
    req.flash('error', 'Pilih minimal satu file untuk diupload');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO attachments (ticket_id, user_id, filename, original_name, mime_type, file_size) VALUES (?,?,?,?,?,?)'
  );

  db.transaction(() => {
    for (const file of req.files) {
      insert.run(ticketId, req.session.user.id, file.filename, file.originalname, file.mimetype, file.size);
    }
  })();

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  notif.onAttachmentAdded(ticket, req.session.user.name, req.files.length, req.session.user.id);

  req.flash('success', `${req.files.length} file berhasil diupload`);
  res.redirect(`/tickets/${ticketId}`);
};

exports.deleteAttachment = (req, res) => {
  const { id: ticketId, attachId } = req.params;
  const user = req.session.user;
  const db = getDb();

  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ? AND ticket_id = ?').get(attachId, ticketId);
  if (!attachment) {
    req.flash('error', 'Lampiran tidak ditemukan');
    return res.redirect(`/tickets/${ticketId}`);
  }

  if (user.role !== 'admin' && attachment.user_id !== user.id) {
    req.flash('error', 'Anda tidak memiliki izin menghapus lampiran ini');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const fp = path.join(UPLOAD_DIR, attachment.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  db.prepare('DELETE FROM attachments WHERE id = ?').run(attachId);
  req.flash('success', 'Lampiran berhasil dihapus');
  res.redirect(`/tickets/${ticketId}`);
};
