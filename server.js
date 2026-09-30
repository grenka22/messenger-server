require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const {
  initDB, saveMessage, getHistory, markRead,
  deleteMessage, deleteForUser, deleteChatForUser, updateMessageText
} = require('./db');

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
let pinnedMessageId = null;

app.use(express.static(path.join(__dirname, 'public')));

// ============ UPLOAD ============
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
        if (total > MAX) {
          reject(new Error('Too big'));
          req.destroy();
          return;
        }
        chunks.push(c);
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

// ============ MEDIA PROXY ============
app.get('/media/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const s3res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
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

// ============ WEBSOCKET ============
wss.on('connection', async (ws) => {
  console.log('🔌 Клиент подключился');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // === HELLO — отправляем историю + pin ===
      if (msg.type === 'hello') {
        try {
          const history = await getHistory(msg.user, 300);

          // ФИКС: чиним нулевую длительность у старых записей
          const fixedHistory = history.map(m => {
            if ((m.type === 'voice' || m.type === 'video') && (!m.duration || m.duration === 0)) {
              return { ...m, duration: 1 };
            }
            return m;
          });

          ws.send(JSON.stringify({ type: 'history', messages: fixedHistory }));
          ws.send(JSON.stringify({ type: 'pin', id: pinnedMessageId }));
        } catch (e) {
          console.error('History error:', e);
        }
        return;
      }

      // === PRESENCE ===
      if (msg.type === 'presence') {
        userStates[msg.user] = {
          online: msg.online,
          last_seen: Date.now(),
          avatar: msg.avatar || userStates[msg.user]?.avatar || null,
          status: msg.status !== undefined ? msg.status : userStates[msg.user]?.status || null,
          typing: msg.typing || false,
        };
        const payload = JSON.stringify({
          type: 'presence',
          user: msg.user,
          online: msg.online,
          avatar: userStates[msg.user].avatar,
          last_seen: userStates[msg.user].last_seen,
          status: userStates[msg.user].status,
          typing: userStates[msg.user].typing,
        });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      // === READ ===
      if (msg.type === 'read') {
        if (msg.ids && msg.ids.length > 0) await markRead(msg.ids);
        const payload = JSON.stringify(msg);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      // === DELETE (одно сообщение) ===
      if (msg.type === 'delete') {
        if (msg.forAll) {
          await deleteMessage(msg.id, true);
          if (pinnedMessageId === msg.id) {
            pinnedMessageId = null;
            const pinPayload = JSON.stringify({ type: 'pin', id: null });
            for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(pinPayload);
          }
        } else {
          await deleteForUser(msg.id, msg.by);
        }
        const payload = JSON.stringify(msg);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      // === DELETE CHAT у себя ===
      if (msg.type === 'delete_chat') {
        await deleteChatForUser(msg.user);
        ws.send(JSON.stringify({ type: 'chat_cleared' }));
        return;
      }

      // === EDIT ===
      if (msg.type === 'edit') {
        await updateMessageText(msg.id, msg.text);
        const payload = JSON.stringify({ type: 'edit', id: msg.id, text: msg.text });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      // === PIN ===
      if (msg.type === 'pin') {
        pinnedMessageId = msg.id;
        const payload = JSON.stringify({ type: 'pin', id: pinnedMessageId });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
        return;
      }

      // === НОВОЕ СООБЩЕНИЕ (text / voice / video / file) ===
      if (['text', 'voice', 'video', 'file'].includes(msg.type)) {
        const saved = await saveMessage({
          ...msg,
          text: msg.text || msg.filename || null,
        });

        const outgoing = {
          id: saved.id,
          type: msg.type,
          sender: msg.sender,
          text: msg.text || null,
          filename: msg.filename || null,
          mediaKey: msg.mediaKey,
          mime: msg.mime,
          duration: msg.duration,
          timestamp: saved.created_at,
          read_at: null,
          edited: false,
        };

        const payload = JSON.stringify(outgoing);
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
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
        userStates[name].typing = false;
        const payload = JSON.stringify({
          type: 'presence',
          user: name,
          online: false,
          avatar: userStates[name].avatar,
          last_seen: now,
          status: userStates[name].status,
          typing: false,
        });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
      }
    }
    console.log('❌ Клиент отключился');
  });
});

// ============ START ============
const PORT = process.env.PORT || 3000;
initDB()
  .then(() => server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`)))
  .catch((e) => {
    console.error('❌ БД:', e);
    process.exit(1);
  });