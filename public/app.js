// === Конфигурация ===
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const MAX_VOICE_SECONDS = 600;
const MAX_CIRCLE_SECONDS = 60;

// === Пользователи ===
const USERS = {
  'Тимофей':  { peer: 'Катюшка' },
  'Катюшка': { peer: 'Тимофей' },
};

// === Элементы ===
const $messages = document.getElementById('messages');
const $input = document.getElementById('textInput');
const $btnSend = document.getElementById('btnSend');
const $btnCircle = document.getElementById('btnCircle');
const $btnVoice = document.getElementById('btnVoice');

const $loginScreen = document.getElementById('loginScreen');
const $peerName = document.getElementById('peerName');
const $peerStatus = document.getElementById('peerStatus');
const $peerAvatar = document.getElementById('peerAvatar');

const $btnProfile = document.getElementById('btnProfile');
const $profileModal = document.getElementById('profileModal');
const $closeProfile = document.getElementById('closeProfile');
const $profileName = document.getElementById('profileName');
const $profileEmail = document.getElementById('profileEmail');
const $avatarInput = document.getElementById('avatarInput');
const $avatarImg = document.getElementById('avatarImg');
const $headerAvatar = document.getElementById('headerAvatar');
const $saveProfile = document.getElementById('saveProfile');

const $circlePreview = document.getElementById('circlePreview');
const $circleVideo = document.getElementById('circleVideo');
const $circleTimer = document.getElementById('circleTimer');
const $circleCancel = document.getElementById('circleCancel');
const $circleSend = document.getElementById('circleSend');

const $recIndicator = document.getElementById('recIndicator');
const $recTime = document.getElementById('recTime');

// === Состояние ===
let ws = null;
let reconnectTimer = null;
let myName = localStorage.getItem('my_name') || '';
let profile = {
  email: localStorage.getItem('profile_email') || '',
  avatar: localStorage.getItem('profile_avatar') || '',
};

let voiceRecorder = null;
let voiceChunks = [];
let voiceStartTime = 0;
let voiceTimerInterval = null;

let circleStream = null;
let circleRecorder = null;
let circleChunks = [];
let circleStartTime = 0;
let circleTimerInterval = null;

// === Логин ===
function showLogin() {
  $loginScreen.classList.remove('hidden');
  document.querySelectorAll('.user-btn').forEach(btn => {
    btn.onclick = () => {
      myName = btn.dataset.user;
      localStorage.setItem('my_name', myName);
      $loginScreen.classList.add('hidden');
      initChat();
    };
  });
}

// === Инициализация чата ===
function initChat() {
  const peer = USERS[myName]?.peer;
  if (!peer) {
    localStorage.removeItem('my_name');
    return showLogin();
  }
  $peerName.textContent = peer;
  updatePeerAvatar();
  connect();
}

function updatePeerAvatar() {
  const peer = USERS[myName]?.peer;
  const key = localStorage.getItem(`peer_avatar_${peer}`);
  if (key) {
    $peerAvatar.innerHTML = `<img src="/media/${encodeURIComponent(key)}" alt="">`;
  }
}

// === WebSocket ===
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('WebSocket подключён');
    ws.send(JSON.stringify({
      type: 'presence',
      user: myName,
      online: true,
      avatar: profile.avatar || null,
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') {
        msg.messages.forEach(renderMessage);
      } else if (msg.type === 'presence') {
        handlePresence(msg);
      } else {
        renderMessage(msg);
      }
    } catch (e) {
      console.error('Ошибка парсинга:', e);
    }
  };

  ws.onclose = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = (err) => console.error('WebSocket ошибка:', err);

  window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'presence', user: myName, online: false }));
    }
  });
}

// === Presence ===
function handlePresence(msg) {
  const peer = USERS[myName]?.peer;
  if (msg.user === peer) {
    if (msg.online) {
      $peerStatus.textContent = 'в сети';
      $peerStatus.className = 'peer-status online';
    } else {
      $peerStatus.textContent = 'не в сети';
      $peerStatus.className = 'peer-status offline';
    }
    if (msg.avatar) {
      localStorage.setItem(`peer_avatar_${peer}`, msg.avatar);
      updatePeerAvatar();
    }
  }
}

// === Текст ===
function sendText() {
  const text = $input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'text', sender: myName, text }));
  $input.value = '';
  $input.focus();
}

// === Отображение ===
function renderMessage(msg) {
  const isMine = msg.sender === myName;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (isMine ? 'mine' : 'theirs');

  if (msg.type === 'text') {
    wrap.textContent = msg.text || '';

  } else if (msg.type === 'voice') {
    const mediaUrl = `/media/${encodeURIComponent(msg.mediaKey)}`;
    wrap.innerHTML = `
      <div class="voice-msg">
        <button class="play-btn">▶</button>
        <canvas class="wave" width="180" height="28"></canvas>
        <span class="dur">${formatDuration(msg.duration || 0)}</span>
      </div>
    `;
    const audio = new Audio(mediaUrl);
    audio.preload = 'metadata';
    const btn = wrap.querySelector('.play-btn');
    const canvas = wrap.querySelector('.wave');
    const ctx = canvas.getContext('2d');

    // Стартовая заглушка
    drawWaveform(ctx, canvas.width, canvas.height, null, isMine ? 'rgba(255,255,255,0.35)' : 'rgba(74,144,226,0.25)');

    let peaks = null;
    fetch(mediaUrl)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(buf);
      })
      .then(audioBuffer => {
        peaks = extractPeaks(audioBuffer, 60);
        drawWaveform(ctx, canvas.width, canvas.height, peaks, isMine ? 'rgba(255,255,255,0.85)' : 'rgba(74,144,226,0.7)', peaks, 0);
      })
      .catch(e => console.warn('Не удалось построить волну:', e));

    btn.addEventListener('click', () => {
      if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
      else { audio.pause(); btn.textContent = '▶'; }
    });
    audio.addEventListener('ended', () => {
      btn.textContent = '▶';
      if (peaks) drawWaveform(ctx, canvas.width, canvas.height, peaks, isMine ? 'rgba(255,255,255,0.85)' : 'rgba(74,144,226,0.7)', peaks, 0);
    });
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || !peaks) return;
      const progress = audio.currentTime / audio.duration;
      drawWaveform(ctx, canvas.width, canvas.height, peaks, isMine ? 'rgba(255,255,255,0.85)' : 'rgba(74,144,226,0.7)', peaks, progress);
    });

  } else if (msg.type === 'video') {
    wrap.innerHTML = `
      <div class="circle-msg">
        <video src="/media/${encodeURIComponent(msg.mediaKey)}" playsinline loop muted preload="metadata"></video>
      </div>
    `;
    const vid = wrap.querySelector('video');
    vid.addEventListener('click', () => {
      if (vid.paused) { vid.muted = false; vid.play(); }
      else { vid.pause(); }
    });
  }

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(msg.timestamp);
  wrap.appendChild(time);

  $messages.appendChild(wrap);
  $messages.scrollTop = $messages.scrollHeight;
}

// === Утилиты ===
function pickMimeType(kind) {
  const candidates = kind === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// === Загрузка ===
async function uploadBlob(blob, ext) {
  const key = `media/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await fetch(`/upload/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) throw new Error('Upload failed: ' + res.status);
  return key;
}

// === Голосовое ===
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType('audio');
    voiceRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    voiceChunks = [];

    voiceRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) voiceChunks.push(e.data);
    };

    voiceRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
      const duration = Math.round((Date.now() - voiceStartTime) / 1000);
      try {
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const key = await uploadBlob(blob, ext);
        ws.send(JSON.stringify({
          type: 'voice', sender: myName, mediaKey: key,
          mime: blob.type, duration,
        }));
      } catch (e) {
        console.error(e);
        alert('Не удалось отправить голосовое: ' + e.message);
      }
    };

    voiceStartTime = Date.now();
    voiceRecorder.start();
    $recIndicator.classList.add('active');
    $btnVoice.classList.add('rec');
    voiceTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - voiceStartTime) / 1000);
      $recTime.textContent = formatDuration(sec);
      if (sec >= MAX_VOICE_SECONDS) stopVoiceRecording();
    }, 200);
  } catch (e) {
    console.error(e);
    alert('Нет доступа к микрофону');
  }
}

function stopVoiceRecording() {
  if (voiceRecorder && voiceRecorder.state === 'recording') voiceRecorder.stop();
  clearInterval(voiceTimerInterval);
  $recIndicator.classList.remove('active');
  $btnVoice.classList.remove('rec');
}

// === Кружок ===
async function startCircleRecording() {
  try {
    circleStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 480, height: 480 },
      audio: true,
    });
    $circleVideo.srcObject = circleStream;
    $circlePreview.classList.add('active');

    const mimeType = pickMimeType('video');
    circleRecorder = mimeType ? new MediaRecorder(circleStream, { mimeType }) : new MediaRecorder(circleStream);
    circleChunks = [];

    circleRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) circleChunks.push(e.data);
    };

    circleRecorder.onstop = async () => {
      circleStream.getTracks().forEach(t => t.stop());
      $circlePreview.classList.remove('active');
      $circleVideo.srcObject = null;

      const blob = new Blob(circleChunks, { type: circleRecorder.mimeType || 'video/webm' });
      const duration = Math.round((Date.now() - circleStartTime) / 1000);
      console.log('Кружок:', blob.size, 'байт, тип:', blob.type, 'длит:', duration);

      try {
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        const key = await uploadBlob(blob, ext);
        ws.send(JSON.stringify({
          type: 'video', sender: myName, mediaKey: key,
          mime: blob.type, duration,
        }));
      } catch (e) {
        console.error(e);
        alert('Не удалось отправить кружок: ' + e.message);
      }
    };

    circleStartTime = Date.now();
    circleRecorder.start();
    circleTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - circleStartTime) / 1000);
      $circleTimer.textContent = `${formatDuration(sec)} / ${formatDuration(MAX_CIRCLE_SECONDS)}`;
      if (sec >= MAX_CIRCLE_SECONDS) stopCircleRecording();
    }, 200);
  } catch (e) {
    console.error(e);
    alert('Нет доступа к камере: ' + e.message);
    if (circleStream) circleStream.getTracks().forEach(t => t.stop());
    $circlePreview.classList.remove('active');
  }
}

function stopCircleRecording() {
  if (circleRecorder && circleRecorder.state === 'recording') circleRecorder.stop();
  clearInterval(circleTimerInterval);
}

// === Волна ===
function extractPeaks(audioBuffer, count) {
  const raw = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(raw.length / count);
  const peaks = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(raw[i * blockSize + j]);
    }
    peaks.push(sum / blockSize);
  }
  const max = Math.max(...peaks);
  return peaks.map(p => p / max);
}

function drawWaveform(ctx, w, h, peaks, color, originalPeaks, progress) {
  ctx.clearRect(0, 0, w, h);
  const bars = peaks ? peaks.length : 60;
  const barW = 2;
  const gap = (w - bars * barW) / (bars - 1);
  const mid = h / 2;

  for (let i = 0; i < bars; i++) {
    const p = peaks ? peaks[i] : 0.4;
    const barH = Math.max(2, p * (h - 4));
    const x = i * (barW + gap);
    const played = progress != null && (i / bars) < progress;
    ctx.fillStyle = played ? (color.includes('255') ? 'rgba(255,255,255,1)' : 'rgba(74,144,226,1)') : color;
    ctx.fillRect(x, mid - barH / 2, barW, barH);
  }
}

// === Профиль ===
function openProfile() {
  $profileName.value = myName;
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
  myName = $profileName.value.trim() || myName;
  profile.email = $profileEmail.value.trim();
  localStorage.setItem('my_name', myName);
  localStorage.setItem('profile_email', profile.email);
  closeProfile();
  alert('Профиль сохранён');
}

async function uploadAvatar(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return alert('Аватарка должна быть меньше 5 МБ');
  const ext = file.name.split('.').pop() || 'jpg';
  const key = `avatars/${myName}_${Date.now()}.${ext}`;
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'presence', user: myName, online: true, avatar: key }));
    }
  } catch (e) {
    console.error(e);
    alert('Не удалось загрузить аватарку');
  }
}

// === События ===
$btnSend.addEventListener('click', sendText);
$input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });

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

// Голосовое: нажатие/отпускание
$btnVoice.addEventListener('mousedown', (e) => { e.preventDefault(); startVoiceRecording(); });
$btnVoice.addEventListener('mouseup', stopVoiceRecording);
$btnVoice.addEventListener('mouseleave', stopVoiceRecording);
$btnVoice.addEventListener('touchstart', (e) => { e.preventDefault(); startVoiceRecording(); }, { passive: false });
$btnVoice.addEventListener('touchend', (e) => { e.preventDefault(); stopVoiceRecording(); }, { passive: false });

$btnCircle.addEventListener('click', startCircleRecording);
$circleCancel.addEventListener('click', () => {
  if (circleRecorder && circleRecorder.state === 'recording') {
    circleRecorder.onstop = null;
    circleRecorder.stop();
  }
  if (circleStream) circleStream.getTracks().forEach(t => t.stop());
  clearInterval(circleTimerInterval);
  $circlePreview.classList.remove('active');
});
$circleSend.addEventListener('click', stopCircleRecording);

// === Старт ===
if (myName && USERS[myName]) {
  $loginScreen.classList.add('hidden');
  initChat();
} else {
  localStorage.removeItem('my_name');
  showLogin();
}