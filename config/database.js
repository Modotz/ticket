const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reporter' CHECK(role IN ('admin', 'reporter', 'technician', 'supervisor')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
      created_by INTEGER NOT NULL,
      assigned_to INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ticket_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // ── Master Kategori ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Master Prioritas (dengan SLA / field waktu) ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS priorities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'secondary',
      duration_value INTEGER NOT NULL DEFAULT 1,
      duration_unit TEXT NOT NULL DEFAULT 'hari' CHECK(duration_unit IN ('jam','hari','minggu')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed kategori (sekali, bila kosong) — sesuai daftar lama
  if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
    const ins = db.prepare('INSERT INTO categories (name) VALUES (?)');
    ['Web Aplikasi', 'Scanner', 'Printer', 'Mobile Approval', 'Jaringan Internet', 'Lainnya']
      .forEach(n => ins.run(n));
    console.log('Seed: master kategori dibuat');
  }

  // Seed prioritas (sekali, bila kosong) — SLA contoh sesuai permintaan
  if (db.prepare('SELECT COUNT(*) c FROM priorities').get().c === 0) {
    const ins = db.prepare(
      'INSERT INTO priorities (code,name,color,duration_value,duration_unit,sort_order) VALUES (?,?,?,?,?,?)'
    );
    [
      ['low',      'Low',      'success', 1, 'minggu', 1],
      ['medium',   'Medium',   'info',    2, 'hari',   2],
      ['high',     'High',     'warning', 1, 'hari',   3],
      ['critical', 'Critical', 'danger',  4, 'jam',    4]
    ].forEach(r => ins.run(...r));
    console.log('Seed: master prioritas dibuat (low=1 minggu, medium=2 hari, high=1 hari, critical=4 jam)');
  }

  // Migrasi: buang CHECK(priority IN ...) pada tabel tickets agar kode
  // prioritas bisa dikelola bebas lewat master Prioritas.
  const ticketsSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'"
  ).get();
  if (ticketsSchema && /CHECK\s*\(\s*priority/i.test(ticketsSchema.sql)) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE tickets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','resolved','closed')),
        created_by INTEGER NOT NULL,
        assigned_to INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      );
      INSERT INTO tickets_new
        SELECT id,ticket_number,title,description,category,priority,status,
               created_by,assigned_to,notes,created_at,updated_at,resolved_at
        FROM tickets;
      DROP TABLE tickets;
      ALTER TABLE tickets_new RENAME TO tickets;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('Migrasi: CHECK constraint priority pada tabel tickets dilepas');
  }

  // Migrasi: tabel users lama punya CHECK(role IN ('admin','reporter','technician'))
  // yang menolak 'supervisor'. SQLite tak bisa ubah CHECK lewat ALTER, jadi
  // tabel dibangun ulang bila constraint lama masih terpasang.
  const usersSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get();
  if (usersSchema && !usersSchema.sql.includes('supervisor')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'reporter' CHECK(role IN ('admin', 'reporter', 'technician', 'supervisor')),
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users_new (id, username, name, email, password, role, is_active, created_at)
        SELECT id, username, name, email, password, role, is_active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log("Migrasi: constraint role pada tabel users diperbarui (menambah 'supervisor')");
  }

  // ── Migrasi kolom tambahan (aman, ADD COLUMN — tanpa rebuild) ─────
  const hasColumn = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);

  if (!hasColumn('users', 'phone')) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    console.log('Migrasi: kolom users.phone ditambahkan (untuk WhatsApp)');
  }
  if (!hasColumn('users', 'telegram_chat_id')) {
    db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT");
    console.log('Migrasi: kolom users.telegram_chat_id ditambahkan (untuk Telegram)');
  }
  if (!hasColumn('tickets', 'due_date')) {
    db.exec("ALTER TABLE tickets ADD COLUMN due_date DATETIME");
    console.log('Migrasi: kolom tickets.due_date ditambahkan (snapshot SLA)');
  }
  if (!hasColumn('tickets', 'sla_escalated')) {
    db.exec("ALTER TABLE tickets ADD COLUMN sla_escalated INTEGER DEFAULT 0");
    console.log('Migrasi: kolom tickets.sla_escalated ditambahkan');
  }

  // Backfill due_date untuk tiket lama (created_at + durasi master prioritas)
  const needDue = db.prepare(
    "SELECT COUNT(*) c FROM tickets WHERE due_date IS NULL"
  ).get().c;
  if (needDue > 0) {
    const rows = db.prepare(`
      SELECT t.id, t.created_at, p.duration_value v, p.duration_unit u
      FROM tickets t LEFT JOIN priorities p ON p.code = t.priority
      WHERE t.due_date IS NULL
    `).all();
    const upd = db.prepare('UPDATE tickets SET due_date = ? WHERE id = ?');
    const unitH = u => (u === 'jam' ? 1 : u === 'minggu' ? 168 : 24);
    db.transaction(() => {
      rows.forEach(r => {
        if (!r.v) return;
        const start = new Date(String(r.created_at).replace(' ', 'T') + 'Z');
        const due = new Date(start.getTime() + r.v * unitH(r.u) * 3600 * 1000);
        upd.run(due.toISOString().slice(0, 19).replace('T', ' '), r.id);
      });
    })();
    console.log(`Migrasi: due_date di-backfill untuk ${rows.length} tiket`);
  }

  // ── Audit trail ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)");

  const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const pw = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hashed = bcrypt.hashSync(pw, 10);
    db.prepare('INSERT INTO users (username, name, email, password, role) VALUES (?, ?, ?, ?, ?)')
      .run('admin', 'Administrator', 'admin@ticket.com', hashed, 'admin');
    console.log(`Akun admin dibuat: username=admin, password=${pw}`);
  }
}

module.exports = { getDb, initDatabase };
