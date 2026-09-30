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
      edited BOOLEAN DEFAULT FALSE
    );
  `);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;`);

  // Таблица персональных удалений (кто у кого удалил)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deletions (
      user_name TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      PRIMARY KEY (user_name, message_id)
    );
  `);

  console.log('✅ Таблица messages и deletions готовы');
}

async function saveMessage(msg) {
  const res = await pool.query(
    `INSERT INTO messages (type, sender, text_content, media_key, media_mime, duration)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [msg.type, msg.sender || null, msg.text || null, msg.mediaKey || null, msg.mime || null, msg.duration || null]
  );
  return res.rows[0];
}

async function getHistory(userName, limit = 300) {
  const res = await pool.query(
    `SELECT m.id, m.type, m.sender, m.text_content AS text, m.media_key AS "mediaKey",
            m.media_mime AS mime, m.duration, m.created_at AS timestamp,
            m.read_at, m.deleted_for_all, m.edited
     FROM messages m
     WHERE m.deleted_for_all = FALSE
       AND m.id NOT IN (SELECT message_id FROM deletions WHERE user_name = $1)
     ORDER BY m.id ASC LIMIT $2`,
    [userName, limit]
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
  if (forAll) {
    await pool.query(`UPDATE messages SET deleted_for_all = TRUE WHERE id = $1`, [id]);
  }
}

async function deleteForUser(id, userName) {
  await pool.query(
    `INSERT INTO deletions (user_name, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userName, id]
  );
}

async function deleteChatForUser(userName) {
  // Помечаем ВСЕ текущие сообщения как удалённые для конкретного пользователя
  await pool.query(
    `INSERT INTO deletions (user_name, message_id)
     SELECT $1, id FROM messages WHERE id NOT IN (SELECT message_id FROM deletions WHERE user_name = $1)
     ON CONFLICT DO NOTHING`,
    [userName]
  );
}

async function updateMessageText(id, newText) {
  await pool.query(
    `UPDATE messages SET text_content = $1, edited = TRUE WHERE id = $2`,
    [newText, id]
  );
}

module.exports = {
  initDB, saveMessage, getHistory, markRead,
  deleteMessage, deleteForUser, deleteChatForUser, updateMessageText
};