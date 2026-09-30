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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      deleted_for_all BOOLEAN DEFAULT FALSE,
      deleted_for_sender BOOLEAN DEFAULT FALSE,
      edited BOOLEAN DEFAULT FALSE
    );
  `);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_sender BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;`);
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
            media_mime AS mime, duration, created_at AS timestamp,
            read_at, deleted_for_all, deleted_for_sender, edited
     FROM messages
     WHERE deleted_for_all = FALSE
     ORDER BY id ASC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function markRead(ids) {
  if (!ids || ids.length === 0) return;
  await pool.query(
    `UPDATE messages SET read_at = NOW() WHERE id = ANY($1::int[]) AND read_at IS NULL`,
    [ids]
  );
}

async function deleteMessage(id, forAll) {
  if (forAll) await pool.query(`UPDATE messages SET deleted_for_all = TRUE WHERE id = $1`, [id]);
  else await pool.query(`UPDATE messages SET deleted_for_sender = TRUE WHERE id = $1`, [id]);
}

async function updateMessageText(id, newText) {
  await pool.query(
    `UPDATE messages SET text_content = $1, edited = TRUE WHERE id = $2`,
    [newText, id]
  );
}

module.exports = { initDB, saveMessage, getHistory, markRead, deleteMessage, updateMessageText };