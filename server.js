/**
 * NextGen Status Boost - VCF Registration Campaign Server (Turso Cloud Edition)
 * -------------------------------------------------------------------------
 */

const express = require('express');
const path = require('path');
const { createClient } = require('@libsql/client');

const PORT = process.env.PORT || 3000;

// Connect to Turso using the secret keys you added in Vercel
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Initialize database tables in the cloud
async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    await db.execute(`
      INSERT INTO settings (key, value)
      SELECT 'target_count', '1500'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'target_count');
    `);
    console.log("Turso Cloud Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
}
initDb();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions to talk to cloud database asynchronously
async function getTarget() {
  const rs = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'target_count'",
    args: []
  });
  return rs.rows.length ? parseInt(rs.rows[0].value, 10) : 1500;
}

async function getCount() {
  const rs = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM contacts",
    args: []
  });
  return rs.rows[0].count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

app.get('/api/status', async (req, res) => {
  try {
    const count = await getCount();
    const target = await getTarget();
    res.json({ count, target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  const { name, phone } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'WhatsApp number is required.' });
  }

  const cleanPhone = phone.replace(/[\s-]/g, '');
  const cleanName = name.trim().slice(0, 100); 

  if (!cleanPhone.startsWith('+')) {
    return res.status(400).json({ error: 'Include your country code starting with +' });
  }

  if (!/^\+\d{6,15}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp number with country code.' });
  }

  try {
    await db.execute({
      sql: "INSERT INTO contacts (name, phone) VALUES (?, ?)",
      args: [cleanName, cleanPhone]
    });
  } catch (err) {
    if (err && /UNIQUE/i.test(err.message)) {
      return res.status(409).json({ error: 'Number already registered!' });
    }
    console.error('Insertion error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  const count = await getCount();
  const target = await getTarget();

  return res.status(201).json({
    success: true,
    count,
    target,
    unlocked: count >= target,
  });
});

app.get('/api/download', async (req, res) => {
  try {
    const count = await getCount();
    const target = await getTarget();

    if (count < target) {
      return res.status(403).json({ error: 'Target has not been reached yet. Download is locked.' });
    }

    const rs = await db.execute("SELECT id, name, phone FROM contacts ORDER BY id ASC");
    let buffer = '';
    rs.rows.forEach((row, index) => {
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
    res.setHeader('Content-Disposition', 'attachment; filename=whatsapp_gain_list.vcf');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

app.post('/api/admin/target', async (req, res) => {
  const { target } = req.body || {};
  const parsed = parseInt(target, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'Target must be a positive integer.' });
  }

  try {
    await db.execute({
      sql: "INSERT INTO settings (key, value) VALUES ('target_count', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [String(parsed)]
    });
    const count = await getCount();
    return res.json({ success: true, target: parsed, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset', async (req, res) => {
  try {
    await db.execute("DELETE FROM contacts");
    const target = await getTarget();
    return res.json({ success: true, count: 0, target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/state', async (req, res) => {
  try {
    const count = await getCount();
    const target = await getTarget();
    res.json({ count, target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
