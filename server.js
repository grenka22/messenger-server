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
const userStates = {};

app.use(express.static(path.join(__dirname, 'public')));

app.put('/upload/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    if (!key) return res.status(400).json({ error: 'No key' });
    const chunks = [];
    let total = 0;
    const MAX = 25 * 1024 * 1024;
    await new Promise((resolve, reject) => {
      req.on('data', (c) => {
        total += c.length;
        if (total > MAX) { reject(new Error('Too big')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
    const body = Buffer.concat(chunks);
    if (body.length === 0) return res.status(400).json({ error: 'Empty body' });
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body,
      ContentType: req.headers['content-type'] || 'application/octet-stream',
    }));
    console.log(`✅ B2: ${key} (${body.length} байт)`);
    res.json({ ok: true, key });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/media/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const s3res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (s3res.ContentType) res.setHeader('Content-Type', s3res.ContentType);
    if (s3res.ContentLength) res.setHeader('Content-Length', s3res.ContentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    s3res.Body.pipe(res);
  } catch (e) {
    console.error('Get media error:', e);
    res.status(500).json({ error: e.message });
  }
});

wss.on('connection', async (ws) => {
  console.log('🔌 Клиент подключился');

  try {
    const history = await getHistory(200);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  } catch (e) { console.error('History error:', e); }

  for (const name in userStates) {
    ws.send(JSON.stringify({
      type: 'presence', user: name,
      online: userStates[name].online,
      avatar: userStates[name].avatar,
      last_seen: userStates[name].last_seen,
      status: userStates[name].status || null,
      typing: userStates[name].typing || false,
    }));
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'presence') {
        userStates[msg.user] = {
          online: msg.online,
          last_seen: Date.now(),
          avatar: msg.avatar || userStates[msg.user]?.avatar || null,
          status: msg.status !== undefined ? msg.status : userStates[msg.user]?.status || null,
          typing: msg.typing || false,
        };
        const payload = JSON.stringify({
          type: 'presence', user: msg.user,
          online: msg.online,
          avatar: userStates[msg.user].avatar,
          last_seen: userStates[msg.user].last_seen,
          status: userStates[msg.user].status,
          typing: userStates[msg.user].typing,
        });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      if (msg.type === 'read') {
        if (msg.ids && msg.ids.length > 0) await markRead(msg.ids);
        const payload = JSON.stringify(msg);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      if (msg.type === 'delete') {
        await deleteMessage(msg.id, msg.forAll);
        const payload = JSON.stringify(msg);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      if (['text', 'voice', 'video', 'file'].includes(msg.type)) {
        const saved = await saveMessage({
          ...msg,
          text: msg.text || msg.filename || null,
        });
        const outgoing = {
          id: saved.id, type: msg.type, sender: msg.sender,
          text: msg.text || null,
          filename: msg.filename || null,
          mediaKey: msg.mediaKey, mime: msg.mime, duration: msg.duration,
          timestamp: saved.created_at, read_at: null,
        };
        const payload = JSON.stringify(outgoing);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
      }
    } catch (e) { console.error('Message error:', e); }
  });

  ws.on('close', () => {
    const now = Date.now();
    for (const name in userStates) {
      if (userStates[name].online) {
        userStates[name].online = false;
        userStates[name].last_seen = now;
        userStates[name].typing = false;
        const payload = JSON.stringify({
          type: 'presence', user: name,
          online: false, avatar: userStates[name].avatar,
          last_seen: now, status: userStates[name].status,
          typing: false,
        });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
      }
    }
    console.log('❌ Клиент отключился');
  });
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`)))
  .catch((e) => { console.error('❌ БД:', e); process.exit(1); });