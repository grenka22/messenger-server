// === Конфигурация ===
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

// === Элементы ===
const $messages = document.getElementById('messages');
const $status = document.getElementById('status');
const $input = document.getElementById('textInput');
const $btnSend = document.getElementById('btnSend');
const $btnCircle = document.getElementById('btnCircle');
const $btnVoice = document.getElementById('btnVoice');

const $btnProfile = document.getElementById('btnProfile');
const $profileModal = document.getElementById('profileModal');
const $closeProfile = document.getElementById('closeProfile');
const $profileName = document.getElementById('profileName');
const $profileEmail = document.getElementById('profileEmail');
const $avatarInput = document.getElementById('avatarInput');
const $avatarImg = document.getElementById('avatarImg');
const $avatarPreview = document.getElementById('avatarPreview');
const $headerAvatar = document.getElementById('headerAvatar');
const $saveProfile = document.getElementById('saveProfile');

// === Состояние ===
let ws = null;
let reconnectTimer = null;
let profile = {
  name: localStorage.getItem('profile_name') || '',
  email: localStorage.getItem('profile_email') || '',
  avatar: localStorage.getItem('profile_avatar') || '', // ключ в B2
};

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

  ws.onerror = (err) => console.error('WebSocket ошибка:', err);
}

// === Отправка текста ===
function sendText() {
  const text = $input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: 'text',
    sender: profile.name || 'me',
    text,
  }));
  $input.value = '';
  $input.focus();
}

// === Отображение сообщения ===
function renderMessage(msg) {
  const isMine = msg.sender === (profile.name || 'me') || msg.sender === 'me';
  const div = document.createElement('div');
  div.className = 'msg ' + (isMine ? 'mine' : 'theirs');

  if (msg.type === 'text') {
    div.textContent = msg.text || '';
  }

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(msg.timestamp);
  div.appendChild(time);

  $messages.appendChild(div);
  $messages.scrollTop = $messages.scrollHeight;
}

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// === Профиль ===
function openProfile() {
  $profileName.value = profile.name;
  $profileEmail.value = profile.email;

  if (profile.avatar) {
    const url = `/media/${encodeURIComponent(profile.avatar)}`;
    $avatarImg.src = url;
    $avatarImg.classList.add('loaded');
    $headerAvatar.src = url;
    $headerAvatar.classList.add('loaded');
  }

  $profileModal.classList.add('active');
}

function closeProfile() {
  $profileModal.classList.remove('active');
}

async function saveProfile() {
  profile.name = $profileName.value.trim();
  profile.email = $profileEmail.value.trim();

  localStorage.setItem('profile_name', profile.name);
  localStorage.setItem('profile_email', profile.email);

  closeProfile();
  alert('Профиль сохранён');
}

// === Загрузка аватарки в B2 ===
async function uploadAvatar(file) {
  if (!file) return;

  // Проверка размера (макс 5 МБ)
  if (file.size > 5 * 1024 * 1024) {
    alert('Аватарка должна быть меньше 5 МБ');
    return;
  }

  // Уникальное имя файла
  const ext = file.name.split('.').pop() || 'jpg';
  const key = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const res = await fetch(`/upload/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    });

    if (!res.ok) throw new Error('Upload failed');

    profile.avatar = key;
    localStorage.setItem('profile_avatar', key);

    const url = `/media/${encodeURIComponent(key)}`;
    $avatarImg.src = url;
    $avatarImg.classList.add('loaded');
    $headerAvatar.src = url;
    $headerAvatar.classList.add('loaded');
  } catch (e) {
    console.error('Ошибка загрузки аватарки:', e);
    alert('Не удалось загрузить аватарку');
  }
}

// === События ===
$btnSend.addEventListener('click', sendText);
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendText();
});

$btnProfile.addEventListener('click', openProfile);
$closeProfile.addEventListener('click', closeProfile);
$saveProfile.addEventListener('click', saveProfile);

$avatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadAvatar(file);
  e.target.value = '';
});

$profileModal.addEventListener('click', (e) => {
  if (e.target === $profileModal) closeProfile();
});

// Заглушки для медиа
$btnCircle.addEventListener('click', () => alert('Кружок — в следующей части'));
$btnVoice.addEventListener('click', () => alert('Голосовое — в следующей части'));

// === Старт ===
if (profile.name) {
  document.title = profile.name + ' — Мессенджер';
}

connect();