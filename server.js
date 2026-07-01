/**
 * NextGen Status Boost - VCF Registration Campaign Server
 * ---------------------------------------------------------
 * Express + built-in node:sqlite backend.
 *
 * Endpoints:
 *   GET  /api/status          -> { count, target }
 *   POST /api/register        -> { name, phone } registers a contact
 *   GET  /api/download        -> streams compiled .vcf file (only when count >= target)
 *   POST /api/admin/target    -> { target } updates the campaign goal
 *   POST /api/admin/reset     -> wipes all contacts + resets counter to 0
 *
 * Data:
 *   vcf_database.db (SQLite)
 *     contacts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT UNIQUE)
 *     settings(key TEXT PRIMARY KEY, value TEXT)
 */

const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'vcf_database.db');

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed the default target if it doesn't exist yet.
const seedTarget = db.prepare(`
  INSERT INTO settings (key, value)
  SELECT 'target_count', '1500'
  WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'target_count')
`);
seedTarget.run();

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmtCountContacts = db.prepare(`SELECT COUNT(*) AS count FROM contacts`);
const stmtGetTarget = db.prepare(`SELECT value FROM settings WHERE key = 'target_count'`);
const stmtSetTarget = db.prepare(`
  INSERT INTO settings (key, value) VALUES ('target_count', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const stmtInsertContact = db.prepare(`INSERT INTO contacts (name, phone) VALUES (?, ?)`);
const stmtAllContacts = db.prepare(`SELECT id, name, phone FROM contacts ORDER BY id ASC`);
const stmtDeleteAllContacts = db.prepare(`DELETE FROM contacts`);
const stmtResetAutoincrement = db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'contacts'`);

function getTarget() {
  const row = stmtGetTarget.get();
  return row ? parseInt(row.value, 10) : 1500;
}

function getCount() {
  return stmtCountContacts.get().count;
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Section A: live dashboard polling target
app.get('/api/status', (req, res) => {
  res.json({ count: getCount(), target: getTarget() });
});

// Section B: registration submission pipeline
app.post('/api/register', (req, res) => {
  const { name, phone } = req.body || {};

  // --- Basic presence validation --------------------------------------
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'WhatsApp number is required.' });
  }

  // --- Step 1: Sanitation & Normalization ------------------------------
  // Strip whitespace and dashes so "+256 701-234 567" -> "+256701234567"
  const cleanPhone = phone.replace(/[\s-]/g, '');
  const cleanName = name.trim().slice(0, 100); // guard against absurdly long input

  // --- Step 2: Protocol Validation ---------------------------------------
  if (!cleanPhone.startsWith('+')) {
    return res.status(400).json({
      error: 'Include your country code starting with +',
    });
  }

  // Extra sanity check: after the +, only digits should remain.
  if (!/^\+\d{6,15}$/.test(cleanPhone)) {
    return res.status(400).json({
      error: 'Please enter a valid WhatsApp number with country code.',
    });
  }

  // --- Step 3: Database Insertion Matrix ---------------------------------
  try {
    stmtInsertContact.run(cleanName, cleanPhone);
  } catch (err) {
    // SQLite UNIQUE constraint violation -> duplicate phone number
    if (err && /UNIQUE/i.test(err.message)) {
      return res.status(409).json({ error: 'Number already registered!' });
    }
    console.error('Insertion error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  const count = getCount();
  const target = getTarget();

  return res.status(201).json({
    success: true,
    count,
    target,
    unlocked: count >= target,
  });
});

// Section C: the VCF compilation + forced download
app.get('/api/download', (req, res) => {
  const count = getCount();
  const target = getTarget();

  if (count < target) {
    return res.status(403).json({
      error: 'Target has not been reached yet. Download is locked.',
    });
  }

  const rows = stmtAllContacts.all();

  // Build the vCard text buffer by concatenating one block per contact.
  let buffer = '';
  rows.forEach((row, index) => {
    const label = `Gain ${index + 1} (${row.name})`;
    buffer +=
      `BEGIN:VCARD\n` +
      `VERSION:3.0\n` +
      `N:;${label};;;\n` +
      `FN:${label}\n` +
      `TEL;TYPE=CELL:${row.phone}\n` +
      `END:VCARD\n`;
  });

  res.setHeader('Content-Type', 'text/vcard');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename=whatsapp_gain_list.vcf'
  );
  res.status(200).send(buffer);
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

// Target Configuration Terminal
app.post('/api/admin/target', (req, res) => {
  const { target } = req.body || {};
  const parsed = parseInt(target, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'Target must be a positive integer.' });
  }

  stmtSetTarget.run(String(parsed));

  return res.json({
    success: true,
    target: parsed,
    count: getCount(),
  });
});

// Master System Purge (Danger Zone)
app.post('/api/admin/reset', (req, res) => {
  stmtDeleteAllContacts.run();
  stmtResetAutoincrement.run();

  return res.json({
    success: true,
    count: 0,
    target: getTarget(),
  });
});

// Lightweight admin read endpoint (used by admin.html to populate current state)
app.get('/api/admin/state', (req, res) => {
  res.json({ count: getCount(), target: getTarget() });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`NextGen Status Boost server running on http://localhost:${PORT}`);
  console.log(`Public site : http://localhost:${PORT}/index.html`);
  console.log(`Admin panel : http://localhost:${PORT}/admin.html`);
});
