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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'ticket-maintenance-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(flash());

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

// uploads harus setelah session agar requireAuth bisa cek req.session.user
app.use('/uploads', require('./middleware/auth').requireAuth, express.static(path.join(__dirname, 'uploads')));

app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/tickets', require('./routes/tickets'));
app.use('/users', require('./routes/users'));
app.use('/notifications', require('./routes/notifications'));

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log('Login default: admin / admin123');
});
