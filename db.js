const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      sender TEXT,
      text_content TEXT,
      media_key TEXT,
      media_mime TEXT,
      duration INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Таблица messages готова');
}

async function saveMessage(msg) {
  const res = await pool.query(
    `INSERT INTO messages (type, sender, text_content, media_key, media_mime, duration)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [msg.type, msg.sender || null, msg.text || null, msg.mediaKey || null, msg.mime || null, msg.duration || null]
  );
  return res.rows[0];
}

async function getHistory(limit = 200) {
  const res = await pool.query(
    `SELECT id, type, sender, text_content AS text, media_key AS "mediaKey",
            media_mime AS mime, duration, created_at AS timestamp
     FROM messages ORDER BY id ASC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = { initDB, saveMessage, getHistory };