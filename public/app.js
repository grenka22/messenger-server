// === Конфигурация ===
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

// === Элементы ===
const $messages = document.getElementById('messages');
const $status = document.getElementById('status');
const $input = document.getElementById('textInput');
const $btnSend = document.getElementById('btnSend');
const $btnCircle = document.getElementById('btnCircle');
const $btnVoice = document.getElementById('btnVoice');

// === Состояние ===
let ws = null;
let reconnectTimer = null;

// === Подключение WebSocket ===
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('✅ WebSocket подключён');
    $status.textContent = '🟢 В сети';
    $status.style.color = '#2E7D32';
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') {
        msg.messages.forEach(renderMessage);
      } else {
        renderMessage(msg);
      }
    } catch (e) {
      console.error('Ошибка парсинга:', e);
    }
  };

  ws.onclose = () => {
    $status.textContent = '⚪ Переподключение…';
    $status.style.color = '#8A6B5A';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket ошибка:', err);
  };
}

// === Отправка текста ===
function sendText() {
  const text = $input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  const msg = {
    type: 'text',
    sender: 'me', // пока без авторизации
    text,
  };
  ws.send(JSON.stringify(msg));
  $input.value = '';
  $input.focus();
}

// === Отображение сообщения ===
function renderMessage(msg) {
  const isMine = msg.sender === 'me' || msg.sender === localStorage.getItem('me');

  const div = document.createElement('div');
  div.className = 'msg ' + (isMine ? 'mine' : 'theirs');

  // Текст
  if (msg.type === 'text') {
    div.textContent = msg.text || '';
  }

  // Время
  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(msg.timestamp);
  div.appendChild(time);

  $messages.appendChild(div);
  $messages.scrollTop = $messages.scrollHeight;
}

// === Форматирование времени ===
function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// === События ===
$btnSend.addEventListener('click', sendText);
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendText();
});

// Заглушки для медиа (реализуем в следующих частях)
$btnCircle.addEventListener('click', () => alert('Кружок — в следующей части'));
$btnVoice.addEventListener('click', () => alert('Голосовое — в следующей части'));

// === Старт ===
connect();