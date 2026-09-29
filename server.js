const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Раздаём статические файлы клиента (позже положим сюда index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище сообщений в памяти (для двух человек этого хватит)
const messages = [];
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('Новый клиент подключился');
  clients.add(ws);

  // Отправляем историю сообщений новому клиенту
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Добавляем время и рассылаем всем
      msg.timestamp = Date.now();
      messages.push(msg);
      // Храним только последние 500 сообщений
      if (messages.length > 500) messages.shift();

      const payload = JSON.stringify(msg);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } catch (e) {
      console.error('Ошибка парсинга:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Клиент отключился');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});