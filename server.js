require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { initDB, saveMessage, getHistory } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// === Backblaze B2 (S3-совместимый) ===
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

// === Раздача статики ===
app.use(express.static(path.join(__dirname, 'public')));

// === Загрузка файла в B2 (надёжный сборщик тела) ===
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

    console.log(`✅ Загружено в B2: ${key} (${body.length} байт)`);
    res.json({ ok: true, key });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === Отдача файла из B2 ===
app.get('/media/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }), { expiresIn: 3600 });
    res.redirect(url);
  } catch (e) {
    console.error('Get media error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === WebSocket чат ===
wss.on('connection', async (ws) => {
  console.log('🔌 Новый клиент подключился');

  try {
    const history = await getHistory(200);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  } catch (e) {
    console.error('History error:', e);
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // Presence — просто рассылаем всем
      if (msg.type === 'presence') {
        const payload = JSON.stringify(msg);
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
        return;
      }

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

  ws.on('close', () => console.log('❌ Клиент отключился'));
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
  })
  .catch((e) => {
    console.error('❌ Ошибка инициализации БД:', e);
    process.exit(1);
  });