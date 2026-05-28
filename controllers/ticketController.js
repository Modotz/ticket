const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { UPLOAD_DIR, isImage, fileIcon, formatBytes } = require('../config/multer');
const notif = require('../helpers/notifications');
const { cleanHtml } = require('../helpers/sanitize');
const audit = require('../helpers/audit');
const ExcelJS = require('exceljs');

// Hitung due_date (string UTC "YYYY-MM-DD HH:MM:SS") dari kode prioritas,
// dihitung sejak `fromIso` (default sekarang) — di-snapshot ke tiket.
function computeDueDate(priorityCode, fromDate) {
  const p = getDb().prepare(
    'SELECT duration_value v, duration_unit u FROM priorities WHERE code = ?'
  ).get(priorityCode);
  if (!p || !p.v) return null;
  const unitH = p.u === 'jam' ? 1 : p.u === 'minggu' ? 168 : 24;
  const base = fromDate ? new Date(fromDate) : new Date();
  const due = new Date(base.getTime() + p.v * unitH * 3600 * 1000);
  return due.toISOString().slice(0, 19).replace('T', ' ');
}

// Susun query daftar tiket + filter (dipakai bersama index & export Excel).
function buildTicketListQuery(user, q) {
  const { status, priority, search, date_from, date_to } = q || {};
  let query = `
    SELECT t.*, u1.name as creator_name, u2.name as assignee_name,
           p.name as priority_name, p.color as priority_color,
           p.duration_value as sla_value, p.duration_unit as sla_unit
    FROM tickets t
    LEFT JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.assigned_to = u2.id
    LEFT JOIN priorities p ON p.code = t.priority
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
  // admin & supervisor melihat semua tiket

  if (status)   { query += ' AND t.status = ?';   params.push(status); }
  if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
  if (search) {
    query += ' AND (t.title LIKE ? OR t.ticket_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (date_from) { query += ' AND date(t.created_at) >= date(?)'; params.push(date_from); }
  if (date_to)   { query += ' AND date(t.created_at) <= date(?)'; params.push(date_to); }

  query += ' ORDER BY t.created_at DESC';
  return { query, params, filters: { status, priority, search, date_from, date_to } };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

const { computeSla } = require('../helpers/sla');

// Cek apakah HTML rich-text kosong (mis. Summernote kirim "<p><br></p>")
function isHtmlEmpty(html) {
  return !String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

// Master Kategori & Prioritas (dikelola lewat menu admin)
function activeCategories() {
  return getDb().prepare('SELECT name FROM categories WHERE is_active = 1 ORDER BY name')
    .all().map(r => r.name);
}
function activePriorities() {
  return getDb().prepare('SELECT * FROM priorities WHERE is_active = 1 ORDER BY sort_order, name')
    .all();
}
function categoryExists(name) {
  return !!getDb().prepare('SELECT 1 FROM categories WHERE name = ?').get(name);
}
function priorityExists(code) {
  return !!getDb().prepare('SELECT 1 FROM priorities WHERE code = ?').get(code);
}

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
  const { query, params, filters } = buildTicketListQuery(req.session.user, req.query);

  // Hitung total (pakai query yg sama, ganti SELECT ... FROM → COUNT(*), buang ORDER BY)
  const countSql = query
    .replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) AS c FROM')
    .replace(/\s+ORDER BY[\s\S]*$/i, '');
  const total = db.prepare(countSql).get(...params).c;

  const perPage = 25;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const offset = (page - 1) * perPage;

  const tickets = db.prepare(query + ' LIMIT ? OFFSET ?')
    .all(...params, perPage, offset)
    .map(t => ({ ...t, sla: computeSla(t) }));

  res.render('tickets/index', {
    title: 'Daftar Tiket',
    tickets,
    filters,
    pagination: { page, totalPages, total, perPage, offset }
  });
};

exports.exportExcel = async (req, res) => {
  const db = getDb();
  const { query, params } = buildTicketListQuery(req.session.user, req.query);
  const tickets = db.prepare(query).all(...params);

  const STATUS_LABEL = {
    open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
    resolved: 'Resolved', closed: 'Closed'
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ticket TSJ';
  wb.created = new Date();
  const ws = wb.addWorksheet('Daftar Tiket', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = [
    { header: 'No. Tiket',    key: 'no',       width: 22 },
    { header: 'Judul',        key: 'title',    width: 40 },
    { header: 'Kategori',     key: 'category', width: 18 },
    { header: 'Prioritas',    key: 'priority', width: 12 },
    { header: 'Status',       key: 'status',   width: 14 },
    { header: 'Pembuat',      key: 'creator',  width: 20 },
    { header: 'Teknisi',      key: 'assignee', width: 20 },
    { header: 'Dibuat',       key: 'created',  width: 20 },
    { header: 'Diselesaikan', key: 'resolved', width: 20 },
    { header: 'Deskripsi',    key: 'desc',     width: 60 }
  ];

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 22;
  ws.autoFilter = 'A1:J1';

  tickets.forEach(t => {
    const row = ws.addRow({
      no: t.ticket_number,
      title: t.title,
      category: t.category,
      priority: (t.priority || '').toUpperCase(),
      status: STATUS_LABEL[t.status] || t.status,
      creator: t.creator_name || '-',
      assignee: t.assignee_name || '-',
      created: t.created_at ? new Date(t.created_at).toLocaleString('id-ID') : '-',
      resolved: t.resolved_at ? new Date(t.resolved_at).toLocaleString('id-ID') : '-',
      desc: stripHtml(t.description)
    });
    row.alignment = { vertical: 'top', wrapText: true };
  });

  ws.eachRow({ includeEmpty: false }, row => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
      };
    });
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daftar-tiket-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
};

exports.createPage = (req, res) => {
  res.render('tickets/create', {
    title: 'Buat Tiket Baru',
    categories: activeCategories(),
    priorities: activePriorities()
  });
};

exports.create = (req, res) => {
  const { title, category, priority } = req.body;
  const db = getDb();
  // Dropzone mengirim via AJAX (X-Requested-With) — balas JSON, bukan redirect
  const isAjax = req.xhr || (req.headers.accept || '').includes('json');

  const description = cleanHtml(req.body.description);

  const fail = (msg, status = 400) => {
    if (isAjax) return res.status(status).json({ error: msg });
    req.flash('error', msg);
    return res.redirect('/tickets/create');
  };

  if (!title || !category || !priority || isHtmlEmpty(description)) {
    return fail('Semua field wajib diisi');
  }
  if (!categoryExists(category)) return fail('Kategori tidak valid');
  if (!priorityExists(priority)) return fail('Prioritas tidak valid');

  const ticketNumber = generateTicketNumber();
  const dueDate = computeDueDate(priority); // snapshot SLA sejak sekarang
  const result = db.prepare('INSERT INTO tickets (ticket_number, title, description, category, priority, created_by, due_date) VALUES (?,?,?,?,?,?,?)')
    .run(ticketNumber, title, description, category, priority, req.session.user.id, dueDate);
  const ticketId = result.lastInsertRowid;
  audit.log(req, 'ticket_created', 'ticket', ticketId, `${ticketNumber} — ${title}`);

  // Lampiran opsional dari Dropzone (upload.any → req.files)
  if (req.files && req.files.length) {
    const insert = db.prepare(
      'INSERT INTO attachments (ticket_id, user_id, filename, original_name, mime_type, file_size) VALUES (?,?,?,?,?,?)'
    );
    db.transaction(() => {
      for (const f of req.files) {
        insert.run(ticketId, req.session.user.id, f.filename, f.originalname, f.mimetype, f.size);
      }
    })();
  }

  notif.onTicketCreated(
    { id: ticketId, ticket_number: ticketNumber, title },
    req.session.user.name
  );

  req.flash('success', `Tiket ${ticketNumber} berhasil dibuat`);
  if (isAjax) return res.json({ redirect: '/tickets' });
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
  let categories = activeCategories();
  if (ticket.category && !categories.includes(ticket.category)) {
    categories = [ticket.category, ...categories]; // tetap tampilkan walau nonaktif
  }
  let priorities = activePriorities();
  if (ticket.priority && !priorities.some(p => p.code === ticket.priority)) {
    const cur = db.prepare('SELECT * FROM priorities WHERE code = ?').get(ticket.priority);
    if (cur) priorities = [cur, ...priorities];
  }
  res.render('tickets/edit', { title: 'Edit Tiket', ticket, categories, priorities });
};

exports.update = (req, res) => {
  const { title, category, priority, notes } = req.body;
  const db = getDb();
  const description = cleanHtml(req.body.description);

  if (!title || !category || !priority || isHtmlEmpty(description)) {
    req.flash('error', 'Judul, deskripsi, kategori, dan prioritas wajib diisi');
    return res.redirect(`/tickets/${req.params.id}/edit`);
  }
  if (!categoryExists(category) || !priorityExists(priority)) {
    req.flash('error', 'Kategori atau prioritas tidak valid');
    return res.redirect(`/tickets/${req.params.id}/edit`);
  }

  const cur = db.prepare('SELECT priority, created_at FROM tickets WHERE id = ?').get(req.params.id);
  if (cur && cur.priority !== priority) {
    // Prioritas berubah → recompute due_date relatif waktu dibuat & reset eskalasi
    const newDue = computeDueDate(priority, new Date(String(cur.created_at).replace(' ', 'T') + 'Z'));
    db.prepare('UPDATE tickets SET title=?, description=?, category=?, priority=?, notes=?, due_date=?, sla_escalated=0, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(title, description, category, priority, notes || null, newDue, req.params.id);
  } else {
    db.prepare('UPDATE tickets SET title=?, description=?, category=?, priority=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(title, description, category, priority, notes || null, req.params.id);
  }
  audit.log(req, 'ticket_updated', 'ticket', req.params.id, title);
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

  audit.log(req, 'ticket_assigned', 'ticket', req.params.id,
    assigned_to ? `ditugaskan ke ${techName || assigned_to}` : 'penugasan dihapus');
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
  audit.log(req, 'status_changed', 'ticket', req.params.id,
    `${ticket.ticket_number}: ${ticket.status} → ${status}`);

  req.flash('success', 'Status tiket berhasil diperbarui');
  res.redirect(`/tickets/${req.params.id}`);
};

exports.addComment = (req, res) => {
  const db = getDb();
  const isAjax = req.xhr || (req.headers.accept || '').includes('json');
  const back = `/tickets/${req.params.id}`;
  const comment = cleanHtml(req.body.comment);

  if (isHtmlEmpty(comment)) {
    if (isAjax) return res.status(400).json({ error: 'Komentar tidak boleh kosong' });
    req.flash('error', 'Komentar tidak boleh kosong');
    return res.redirect(back);
  }

  db.prepare('INSERT INTO comments (ticket_id, user_id, comment) VALUES (?,?,?)')
    .run(req.params.id, req.session.user.id, comment);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  notif.onCommentAdded(ticket, req.session.user.name, req.session.user.id);
  audit.log(req, 'comment_added', 'ticket', req.params.id, ticket && ticket.ticket_number);

  req.flash('success', 'Komentar berhasil ditambahkan');
  if (isAjax) return res.json({ redirect: back });
  res.redirect(back);
};

exports.deleteTicket = (req, res) => {
  const db = getDb();
  // hapus file attachment dari disk sebelum delete ticket
  const attachments = db.prepare('SELECT filename FROM attachments WHERE ticket_id = ?').all(req.params.id);
  attachments.forEach(a => {
    const fp = path.join(UPLOAD_DIR, a.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  const tk = db.prepare('SELECT ticket_number FROM tickets WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  audit.log(req, 'ticket_deleted', 'ticket', req.params.id, tk && tk.ticket_number);
  req.flash('success', 'Tiket berhasil dihapus');
  res.redirect('/tickets');
};

exports.uploadAttachment = (req, res) => {
  const ticketId = req.params.id;
  const isAjax = req.xhr || (req.headers.accept || '').includes('json');
  const back = `/tickets/${ticketId}`;

  if (!req.files || req.files.length === 0) {
    if (isAjax) return res.status(400).json({ error: 'Pilih minimal satu file untuk diupload' });
    req.flash('error', 'Pilih minimal satu file untuk diupload');
    return res.redirect(back);
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
  audit.log(req, 'attachment_added', 'ticket', ticketId, `${req.files.length} file`);

  req.flash('success', `${req.files.length} file berhasil diupload`);
  if (isAjax) return res.json({ redirect: back });
  res.redirect(back);
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
  audit.log(req, 'attachment_deleted', 'ticket', ticketId, attachment.original_name);
  req.flash('success', 'Lampiran berhasil dihapus');
  res.redirect(`/tickets/${ticketId}`);
};
