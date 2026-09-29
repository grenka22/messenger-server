require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { initDB, saveMessage, getHistory, markRead, deleteMessage } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// === Backblaze B2 ===
const s3 = new S3Client({
  region: process.env.B2_REGION,
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.B2_BUCKET;

// === Статусы пользователей (в памяти) ===
const userStates = {};

// === Статика ===
app.use(express.static(path.join(__dirname, 'public')));

// === Загрузка в B2 ===
app.put('/upload/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    if (!key) return res.status(400).json({ error: 'No key' });

    const chunks = [];
    let total = 0;
    const MAX = 25 * 1024 * 1024;

    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX) {
          reject(new Error('Файл больше 25 МБ'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = Buffer.concat(chunks);
    if (body.length === 0) return res.status(400).json({ error: 'Empty body' });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: req.headers['content-type'] || 'application/octet-stream',
    }));

    console.log(`✅ B2: ${key} (${body.length} байт)`);
    res.json({ ok: true, key });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === Отдача из B2 (проксирование, обход CORS) ===
app.get('/media/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const s3res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));

    if (s3res.ContentType) res.setHeader('Content-Type', s3res.ContentType);
    if (s3res.ContentLength) res.setHeader('Content-Length', s3res.ContentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    s3res.Body.pipe(res);
  } catch (e) {
    console.error('Get media error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === WebSocket ===
wss.on('connection', async (ws) => {
  console.log('🔌 Клиент подключился');

  try {
    const history = await getHistory(200);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  } catch (e) {
    console.error('History error:', e);
  }

  // Отправляем текущие статусы всех пользователей
  for (const name in userStates) {
    ws.send(JSON.stringify({
      type: 'presence',
      user: name,
      online: userStates[name].online,
      avatar: userStates[name].avatar,
      last_seen: userStates[name].last_seen,
    }));
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // === Presence ===
      if (msg.type === 'presence') {
        userStates[msg.user] = {
          online: msg.online,
          last_seen: Date.now(),
          avatar: msg.avatar || userStates[msg.user]?.avatar || null,
        };

        const payload = JSON.stringify({
          type: 'presence',
          user: msg.user,
          online: msg.online,
          avatar: userStates[msg.user].avatar,
          last_seen: userStates[msg.user].last_seen,
        });

        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
        return;
      }

      // === Прочтено ===
      if (msg.type === 'read') {
        if (msg.ids && msg.ids.length > 0) {
          await markRead(msg.ids);
        }
        const payload = JSON.stringify(msg);
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
        return;
      }

      // === Удаление ===
      if (msg.type === 'delete') {
        await deleteMessage(msg.id, msg.forAll);
        const payload = JSON.stringify(msg);
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
        return;
      }

      // === Текст / ГС / кружок ===
      if (msg.type === 'text' || msg.type === 'voice' || msg.type === 'video') {
        const saved = await saveMessage(msg);
        const outgoing = {
          id: saved.id,
          type: msg.type,
          sender: msg.sender,
          text: msg.text,
          mediaKey: msg.mediaKey,
          mime: msg.mime,
          duration: msg.duration,
          timestamp: saved.created_at,
          read_at: null,
        };
        const payload = JSON.stringify(outgoing);
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    const now = Date.now();
    for (const name in userStates) {
      if (userStates[name].online) {
        userStates[name].online = false;
        userStates[name].last_seen = now;

        const payload = JSON.stringify({
          type: 'presence',
          user: name,
          online: false,
          avatar: userStates[name].avatar,
          last_seen: now,
        });

        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      }
    }
    console.log('❌ Клиент отключился');
  });
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`)))
  .catch((e) => {
    console.error('❌ Ошибка инициализации БД:', e);
    process.exit(1);
  });