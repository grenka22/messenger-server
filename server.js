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

// Backblaze B2 (S3-совместимый)
const s3 = new S3Client({
  region: process.env.B2_REGION,
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const BUCKET = process.env.B2_BUCKET;

// Раздаём статику клиента
app.use(express.static(path.join(__dirname, 'public')));

// API для загрузки медиа (клиент сначала загружает файл сюда, потом шлёт WS-сообщение)
app.put('/upload/:key', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: req.params.key,
      Body: req.body,
      ContentType: req.headers['content-type'] || 'application/octet-stream',
    }));
    res.json({ ok: true, key: req.params.key });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// API для получения временной ссылки на скачивание медиа
app.get('/media/:key', async (req, res) => {
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET,
      Key: req.params.key,
    }), { expiresIn: 3600 });
    res.redirect(url);
  } catch (e) {
    console.error('Get media error:', e);
    res.status(500).json({ error: e.message });
  }
});

// WebSocket чат
wss.on('connection', async (ws) => {
  console.log('Новый клиент подключился');

  try {
    const history = await getHistory(200);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  } catch (e) {
    console.error('History error:', e);
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

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

  ws.on('close', () => console.log('Клиент отключился'));
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