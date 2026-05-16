require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const { initDatabase, getDb } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3333;

initDatabase();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layouts/main');

const isProd = process.env.NODE_ENV === 'production';
// Cookie `secure` HARUS dimatikan saat diakses lewat HTTP (mis. localhost),
// kalau tidak browser membuang cookie sesi → tidak bisa login. Aktifkan
// COOKIE_SECURE=true HANYA bila aplikasi benar-benar di belakang HTTPS.
const cookieSecure = String(process.env.COOKIE_SECURE).toLowerCase() === 'true';
if (cookieSecure) app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure      // true HANYA bila di belakang HTTPS
  }
}));

app.use(flash());

// ── Proteksi CSRF (synchronizer token) ───────────────────────────
// Token per sesi; diverifikasi untuk semua method yang mengubah data.
// Klien mengirim lewat hidden input `_csrf` (form) atau header
// `x-csrf-token` (fetch) — keduanya di-inject otomatis oleh layout.
app.use((req, res, next) => {
  if (req.session && !req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session ? req.session.csrf : '';
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (safe) return next();
  const sent = (req.headers['x-csrf-token']) ||
               (req.body && req.body._csrf) ||
               (req.query && req.query._csrf);
  if (sent && req.session && sent === req.session.csrf) return next();
  if (req.xhr || (req.headers.accept || '').includes('json')) {
    return res.status(403).json({ error: 'Sesi kedaluwarsa / token tidak valid. Muat ulang halaman.' });
  }
  req.flash('error', 'Token keamanan tidak valid. Silakan coba lagi.');
  return res.redirect('back');
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');

  if (req.session.user) {
    const db = getDb();
    const uid = req.session.user.id;
    res.locals.notifCount = db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(uid).c;
    res.locals.notifRecent = db.prepare(`
      SELECT n.*, t.ticket_number
      FROM notifications n
      LEFT JOIN tickets t ON n.ticket_id = t.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC LIMIT 8
    `).all(uid);
  } else {
    res.locals.notifCount = 0;
    res.locals.notifRecent = [];
  }

  // helper timeAgo tersedia di semua view
  res.locals.timeAgo = (dateStr) => {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60)    return `${diff} dtk lalu`;
    if (diff < 3600)  return `${Math.floor(diff / 60)} mnt lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    if (diff < 604800)return `${Math.floor(diff / 86400)} hari lalu`;
    return new Date(dateStr).toLocaleDateString('id-ID');
  };

  next();
});

// Halaman dinamis JANGAN di-cache browser — supaya perubahan view/script
// langsung terpakai tanpa perlu hard-refresh manual. (Aset statis di
// /public & /vendor sudah ditangani express.static di atas, tak terkena ini.)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// uploads harus setelah session agar requireAuth bisa cek req.session.user
app.use('/uploads', require('./middleware/auth').requireAuth, express.static(path.join(__dirname, 'uploads')));

app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/tickets', require('./routes/tickets'));
app.use('/users', require('./routes/users'));
app.use('/categories', require('./routes/categories'));
app.use('/priorities', require('./routes/priorities'));
app.use('/audit', require('./routes/audit'));
app.use('/notifications', require('./routes/notifications'));

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});

// ── Penjadwal eskalasi SLA ───────────────────────────────────────
if (String(process.env.SLA_ESCALATION_ENABLED).toLowerCase() !== 'false') {
  const notif = require('./helpers/notifications');
  const audit = require('./helpers/audit');
  const mins = Math.max(1, parseInt(process.env.SLA_CHECK_INTERVAL_MIN, 10) || 15);

  const checkSla = () => {
    try {
      const db = getDb();
      const overdue = db.prepare(`
        SELECT * FROM tickets
        WHERE status NOT IN ('resolved','closed')
          AND due_date IS NOT NULL
          AND sla_escalated = 0
          AND datetime(due_date) < datetime('now')
      `).all();
      overdue.forEach(t => {
        notif.onSlaEscalation(t);
        db.prepare('UPDATE tickets SET sla_escalated = 1 WHERE id = ?').run(t.id);
        audit.log(null, 'sla_escalation', 'ticket', t.id,
          `Tiket ${t.ticket_number} lewat SLA (due ${t.due_date})`);
      });
      if (overdue.length) console.log(`[SLA] ${overdue.length} tiket dieskalasi`);
    } catch (e) {
      console.warn('[SLA] gagal cek eskalasi:', e.message);
    }
  };
  setTimeout(checkSla, 30 * 1000);                 // cek awal 30 dtk setelah start
  setInterval(checkSla, mins * 60 * 1000);
  console.log(`Eskalasi SLA aktif (tiap ${mins} menit)`);
}
