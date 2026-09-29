// === Конфигурация ===
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const MAX_VOICE_SECONDS = 600;
const MIN_VOICE_SECONDS = 1;
const MAX_CIRCLE_SECONDS = 60;

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
let myName = '';
let profile = {
  email: localStorage.getItem('profile_email') || '',
  avatar: localStorage.getItem('profile_avatar') || '',
};

let voiceRecorder = null;
let voiceChunks = [];
let voiceStartTime = 0;
let voiceTimerInterval = null;
let voiceStream = null;

let circleStream = null;
let circleRecorder = null;
let circleChunks = [];
let circleStartTime = 0;
let circleTimerInterval = null;

// Хранилище отрендеренных сообщений (id → DOM)
const renderedMessages = new Map();

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

function initChat() {
  const peer = USERS[myName]?.peer;
  if (!peer) return showLogin();
  $peerName.textContent = peer;
  $peerStatus.textContent = 'не в сети';
  $peerStatus.className = 'peer-status offline';
  updatePeerAvatar();
  if (profile.avatar) {
    const url = `/media/${encodeURIComponent(profile.avatar)}`;
    $headerAvatar.src = url;
    $headerAvatar.classList.add('loaded');
  }
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
    console.log('WS connected');
    // Первое presence
    sendPresence();
    // Повторное через 1 сек на случай, если собеседник ещё не подключён
    setTimeout(sendPresence, 1000);
    // И через 3 сек — на случай, если Render «просыпается»
    setTimeout(sendPresence, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') {
        msg.messages.forEach(renderMessage);
        // Помечаем все входящие как прочитанные
        markAllRead();
      } else if (msg.type === 'presence') {
        handlePresence(msg);
      } else if (msg.type === 'read') {
        handleRead(msg);
      } else if (msg.type === 'delete') {
        handleDelete(msg);
      } else {
        renderMessage(msg);
        // Если сообщение входящее — сразу помечаем прочитанным
        if (msg.sender !== myName && msg.id) {
          markRead([msg.id]);
        }
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  ws.onclose = () => {
    const peer = USERS[myName]?.peer;
    if (peer) {
      $peerStatus.textContent = 'не в сети';
      $peerStatus.className = 'peer-status offline';
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = (err) => console.error('WS error:', err);
}

function sendPresence() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'presence',
      user: myName,
      online: true,
      avatar: profile.avatar || null,
    }));
  }
}

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
    // Если собеседник онлайн — отправим своё presence обратно, чтобы он нас увидел
    if (msg.online) sendPresence();
  }
}

function handleRead(msg) {
  if (!msg.ids) return;
  msg.ids.forEach(id => {
    const el = renderedMessages.get(id);
    if (el) {
      const check = el.querySelector('.read-check');
      if (check) check.classList.add('read');
    }
  });
}

function handleDelete(msg) {
  const el = renderedMessages.get(msg.id);
  if (el) {
    if (msg.forAll) {
      el.remove();
    } else {
      // Удаление только у себя — возможно, это не мы отправили, просто игнорируем
      el.remove();
    }
    renderedMessages.delete(msg.id);
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

// === Прочитано ===
function markRead(ids) {
  if (!ids.length || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'read', ids, by: myName }));
}

function markAllRead() {
  const ids = [];
  renderedMessages.forEach((el, id) => {
    if (el.classList.contains('theirs')) ids.push(id);
  });
  if (ids.length) markRead(ids);
}

// === Отображение ===
function renderMessage(msg) {
  if (msg.id && renderedMessages.has(msg.id)) return; // уже отрисовано
  const isMine = msg.sender === myName;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (isMine ? 'mine' : 'theirs');
  if (msg.id) wrap.dataset.id = msg.id;

  if (msg.type === 'text') {
    wrap.textContent = msg.text || '';
  } else if (msg.type === 'voice') {
    wrap.appendChild(buildVoicePlayer(msg, isMine));
  } else if (msg.type === 'video') {
    wrap.appendChild(buildCirclePlayer(msg));
  }

  // Время + галочки + кнопка меню
  const meta = document.createElement('div');
  meta.className = 'meta';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(msg.timestamp);
  meta.appendChild(time);

  if (isMine) {
    const check = document.createElement('span');
    check.className = 'read-check' + (msg.read_at ? ' read' : '');
    check.textContent = '✓✓';
    meta.appendChild(check);
  }

  const menu = document.createElement('button');
  menu.className = 'msg-menu';
  menu.textContent = '⋮';
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    showMessageMenu(msg, wrap);
  });
  meta.appendChild(menu);

  wrap.appendChild(meta);

  $messages.appendChild(wrap);
  $messages.scrollTop = $messages.scrollHeight;
  if (msg.id) renderedMessages.set(msg.id, wrap);
}

// === Плеер голосового с перемоткой ===
function buildVoicePlayer(msg, isMine) {
  const mediaUrl = `/media/${encodeURIComponent(msg.mediaKey)}`;
  const box = document.createElement('div');
  box.className = 'voice-msg';
  box.innerHTML = `
    <button class="play-btn">▶</button>
    <canvas class="wave" width="180" height="28"></canvas>
    <span class="dur">${formatDuration(msg.duration || 0)}</span>
  `;
  const audio = new Audio(mediaUrl);
  audio.preload = 'metadata';
  const btn = box.querySelector('.play-btn');
  const canvas = box.querySelector('.wave');
  const durEl = box.querySelector('.dur');
  const ctx = canvas.getContext('2d');
  const colorMain = isMine ? 'rgba(255,255,255,0.85)' : 'rgba(74,144,226,0.7)';
  const colorBg = isMine ? 'rgba(255,255,255,0.35)' : 'rgba(74,144,226,0.25)';

  drawWaveform(ctx, canvas.width, canvas.height, null, colorBg);

  let peaks = null;
  fetch(mediaUrl)
    .then(r => r.arrayBuffer())
    .then(buf => {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx.decodeAudioData(buf);
    })
    .then(audioBuffer => {
      peaks = extractPeaks(audioBuffer, 60);
      drawWaveform(ctx, canvas.width, canvas.height, peaks, colorMain, peaks, 0);
    })
    .catch(e => console.warn('Waveform error:', e));

  // Клик по волне — перемотка
  canvas.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  btn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
    else { audio.pause(); btn.textContent = '▶'; }
  });
  audio.addEventListener('ended', () => {
    btn.textContent = '▶';
    if (peaks) drawWaveform(ctx, canvas.width, canvas.height, peaks, colorMain, peaks, 0);
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration || !peaks) return;
    const progress = audio.currentTime / audio.duration;
    drawWaveform(ctx, canvas.width, canvas.height, peaks, colorMain, peaks, progress);
    durEl.textContent = formatDuration(Math.floor(audio.currentTime));
  });
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && isFinite(audio.duration)) {
      durEl.textContent = formatDuration(Math.floor(audio.duration));
    }
  });

  return box;
}

// === Плеер кружка с перемоткой ===
function buildCirclePlayer(msg) {
  const box = document.createElement('div');
  box.className = 'circle-msg';
  box.innerHTML = `
    <video src="/media/${encodeURIComponent(msg.mediaKey)}"
           playsinline muted preload="metadata"></video>
    <div class="circle-progress"><div class="circle-fill"></div></div>
  `;
  const vid = box.querySelector('video');
  const fill = box.querySelector('.circle-fill');
  const progress = box.querySelector('.circle-progress');

  vid.addEventListener('loadedmetadata', () => {
    vid.currentTime = 0.001; // показать первый кадр
  });

  // Клик по видео — play/pause
  vid.addEventListener('click', (e) => {
    e.stopPropagation();
    if (vid.paused) { vid.muted = false; vid.play(); }
    else { vid.pause(); }
  });

  // Перемотка по клику на полосу прогресса
  progress.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!vid.duration) return;
    const rect = progress.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    vid.currentTime = ratio * vid.duration;
  });

  vid.addEventListener('timeupdate', () => {
    if (!vid.duration) return;
    fill.style.width = (vid.currentTime / vid.duration * 100) + '%';
  });
  vid.addEventListener('ended', () => { fill.style.width = '0%'; });

  return box;
}

// === Утилиты ===
function pickMimeType(kind) {
  const candidates = kind === 'video'
    ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
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
function uploadBlobWithProgress(blob, ext, onProgress) {
  return new Promise((resolve, reject) => {
    const key = `media/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/upload/${encodeURIComponent(key)}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(key);
      else reject(new Error('Upload failed: ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.timeout = 120000;
    xhr.send(blob);
  });
}

function showUploadingBubble(label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg mine';
  wrap.innerHTML = `
    <div class="upload-progress">
      <div class="upload-label">${label}</div>
      <div class="upload-bar"><div class="upload-fill"></div></div>
      <div class="upload-pct">0%</div>
    </div>
  `;
  $messages.appendChild(wrap);
  $messages.scrollTop = $messages.scrollHeight;
  return {
    setProgress: (pct) => {
      wrap.querySelector('.upload-fill').style.width = pct + '%';
      wrap.querySelector('.upload-pct').textContent = pct + '%';
    },
    remove: () => wrap.remove(),
  };
}

// === ГОЛОСОВОЕ ===
async function startVoiceRecording() {
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType('audio');
    voiceRecorder = mimeType ? new MediaRecorder(voiceStream, { mimeType }) : new MediaRecorder(voiceStream);
    voiceChunks = [];

    voiceRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) voiceChunks.push(e.data);
    };

    voiceRecorder.onstop = async () => {
      // ВАЖНО: останавливаем поток
      if (voiceStream) {
        voiceStream.getTracks().forEach(t => t.stop());
        voiceStream = null;
      }
      const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
      const duration = Math.round((Date.now() - voiceStartTime) / 1000);

      if (duration < MIN_VOICE_SECONDS) {
        alert('Слишком короткое голосовое (минимум 1 сек)');
        return;
      }
      if (blob.size === 0) {
        alert('Пустая запись, попробуйте снова');
        return;
      }
      console.log('ГС:', (blob.size / 1024).toFixed(0), 'КБ, длит:', duration);

      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      const bubble = showUploadingBubble('Голосовое');
      try {
        const key = await uploadBlobWithProgress(blob, ext, (p) => bubble.setProgress(p));
        bubble.remove();
        ws.send(JSON.stringify({
          type: 'voice', sender: myName, mediaKey: key,
          mime: blob.type, duration,
        }));
      } catch (e) {
        bubble.remove();
        console.error(e);
        alert('Не удалось отправить голосовое: ' + e.message);
      }
    };

    voiceStartTime = Date.now();
    voiceRecorder.start(100); // запрашивать данные каждые 100мс — исправляет 0-секундные записи
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
  if (voiceRecorder && voiceRecorder.state === 'recording') {
    voiceRecorder.requestData(); // принудительно забираем последние данные
    voiceRecorder.stop();
  }
  clearInterval(voiceTimerInterval);
  $recIndicator.classList.remove('active');
  $btnVoice.classList.remove('rec');
}

// === КРУЖОК ===
async function startCircleRecording() {
  try {
    circleStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 320, height: 320, frameRate: 20 },
      audio: true,
    });
    $circleVideo.srcObject = circleStream;
    $circlePreview.classList.add('active');

    const mimeType = pickMimeType('video');
    circleRecorder = mimeType
      ? new MediaRecorder(circleStream, { mimeType, videoBitsPerSecond: 400000, audioBitsPerSecond: 64000 })
      : new MediaRecorder(circleStream);
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
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const bubble = showUploadingBubble('Кружок');
      try {
        const key = await uploadBlobWithProgress(blob, ext, (p) => bubble.setProgress(p));
        bubble.remove();
        ws.send(JSON.stringify({
          type: 'video', sender: myName, mediaKey: key,
          mime: blob.type, duration,
        }));
      } catch (e) {
        bubble.remove();
        console.error(e);
        alert('Не удалось отправить кружок: ' + e.message);
      }
    };

    circleStartTime = Date.now();
    circleRecorder.start(100);
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
  if (circleRecorder && circleRecorder.state === 'recording') {
    circleRecorder.requestData();
    circleRecorder.stop();
  }
  clearInterval(circleTimerInterval);
}

// === Меню сообщения ===
function showMessageMenu(msg, wrap) {
  // Удаляем старое меню
  document.querySelectorAll('.msg-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'msg-popup';
  popup.innerHTML = `
    <button data-action="delete-me">Удалить у себя</button>
    <button data-action="delete-all">Удалить у обоих</button>
  `;

  popup.querySelector('[data-action="delete-me"]').addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'delete', id: msg.id, forAll: false, by: myName }));
    popup.remove();
  });
  popup.querySelector('[data-action="delete-all"]').addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'delete', id: msg.id, forAll: true, by: myName }));
    popup.remove();
  });

  document.body.appendChild(popup);
  const rect = wrap.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top = (rect.bottom + 5) + 'px';
  popup.style.left = Math.max(10, rect.left) + 'px';
  popup.style.zIndex = '300';

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 10);
}

// === Волна ===
function extractPeaks(audioBuffer, count) {
  const raw = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(raw.length / count);
  const peaks = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) sum += Math.abs(raw[i * blockSize + j]);
    peaks.push(sum / blockSize);
  }
  const max = Math.max(...peaks) || 1;
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
  }
  $profileModal.classList.add('active');
}

function closeProfile() { $profileModal.classList.remove('active'); }

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
    if (ws && ws.readyState === WebSocket.OPEN) sendPresence();
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

// === Старт — всегда логин ===
showLogin();