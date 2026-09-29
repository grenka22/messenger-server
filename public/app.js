// ==================== КОНФИГ ====================
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const MAX_VOICE_SECONDS = 600;
const MIN_VOICE_SECONDS = 1;
const MAX_CIRCLE_SECONDS = 60;

const USERS = {
  'Тимофей':  { peer: 'Катюшка' },
  'Катюшка': { peer: 'Тимофей' },
};

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const EMOJI_LIBRARY = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
  '😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','🧐','😕',
  '😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩',
  '😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖','❤️','🧡','💛',
  '💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','🔥','✨','⭐',
  '🌟','💫','💥','💦','💨','💬','💭','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟',
  '🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','🤝','💪',
];

// ==================== ЭЛЕМЕНТЫ ====================
const $messages = document.getElementById('messages');
const $input = document.getElementById('textInput');
const $btnSend = document.getElementById('btnSend');
const $btnCircle = document.getElementById('btnCircle');
const $btnVoice = document.getElementById('btnVoice');
const $btnAttach = document.getElementById('btnAttach');
const $btnEmoji = document.getElementById('btnEmoji');
const $fileInput = document.getElementById('fileInput');
const $loginScreen = document.getElementById('loginScreen');
const $peerName = document.getElementById('peerName');
const $peerStatus = document.getElementById('peerStatus');
const $peerAvatar = document.getElementById('peerAvatar');
const $peerStatusIcon = document.getElementById('peerStatusIcon');
const $statusTooltip = document.getElementById('statusTooltip');
const $btnProfile = document.getElementById('btnProfile');
const $profileModal = document.getElementById('profileModal');
const $closeProfile = document.getElementById('closeProfile');
const $profileName = document.getElementById('profileName');
const $profileEmail = document.getElementById('profileEmail');
const $avatarInput = document.getElementById('avatarInput');
const $avatarImg = document.getElementById('avatarImg');
const $headerAvatar = document.getElementById('headerAvatar');
const $saveProfile = document.getElementById('saveProfile');
const $openStatusFromProfile = document.getElementById('openStatusFromProfile');
const $statusModal = document.getElementById('statusModal');
const $closeStatus = document.getElementById('closeStatus');
const $clearStatus = document.getElementById('clearStatus');
const $emojiModal = document.getElementById('emojiModal');
const $closeEmoji = document.getElementById('closeEmoji');
const $emojiCurrent = document.getElementById('emojiCurrent');
const $emojiScroll = document.getElementById('emojiScroll');
const $emojiDesc = document.getElementById('emojiDesc');
const $saveEmoji = document.getElementById('saveEmoji');
const $recentStatusesBlock = document.getElementById('recentStatusesBlock');
const $recentStatuses = document.getElementById('recentStatuses');
const $circlePreview = document.getElementById('circlePreview');
const $circleVideo = document.getElementById('circleVideo');
const $circleTimer = document.getElementById('circleTimer');
const $circleCancel = document.getElementById('circleCancel');
const $circleSend = document.getElementById('circleSend');
const $recIndicator = document.getElementById('recIndicator');
const $recTime = document.getElementById('recTime');

// ==================== СОСТОЯНИЕ ====================
let ws = null;
let reconnectTimer = null;
let myName = '';
let profile = { email: '' };
let myStatus = null;
let peerStatusData = null;
let selectedEmoji = '🙂';
let typingTimer = null;
let isTyping = false;
let peerIsTyping = false;

let voiceRecorder = null, voiceChunks = [], voiceStartTime = 0, voiceTimerInterval = null, voiceStream = null;
let circleStream = null, circleRecorder = null, circleChunks = [], circleStartTime = 0, circleTimerInterval = null;

const renderedMessages = new Map();

// ==================== КЛЮЧИ ====================
const myAvatarKey = () => `avatar_${myName}`;
const peerAvatarKey = (p) => `peer_avatar_${p}`;

// ==================== ЛОГИН ====================
function showLogin() {
  $loginScreen.classList.remove('hidden');
  document.querySelectorAll('.user-btn').forEach(btn => {
    btn.onclick = () => {
      myName = btn.dataset.user;
      profile.email = localStorage.getItem(`email_${myName}`) || '';
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

  try {
    const s = localStorage.getItem(`status_${myName}`);
    if (s) myStatus = JSON.parse(s);
  } catch (e) {}

  try {
    const ps = localStorage.getItem(`peer_status_${peer}`);
    if (ps) { peerStatusData = JSON.parse(ps); setTimeout(updatePeerStatusIcon, 100); }
  } catch (e) {}

  const myAv = localStorage.getItem(myAvatarKey());
  if (myAv) {
    const url = `/media/${encodeURIComponent(myAv)}`;
    $headerAvatar.src = url;
    $headerAvatar.classList.add('loaded');
  } else {
    $headerAvatar.classList.remove('loaded');
  }

  updatePeerAvatar();
  connect();
}

function updatePeerAvatar() {
  const peer = USERS[myName]?.peer;
  const key = localStorage.getItem(peerAvatarKey(peer));
  if (key) $peerAvatar.innerHTML = `<img src="/media/${encodeURIComponent(key)}" alt="">`;
  else $peerAvatar.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="#C9B0A0"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>`;
}

// ==================== WEBSOCKET ====================
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { console.log('WS connected'); sendPresence(); setTimeout(sendPresence, 1000); setTimeout(sendPresence, 3000); };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') { msg.messages.forEach(renderMessage); markAllRead(); }
      else if (msg.type === 'presence') handlePresence(msg);
      else if (msg.type === 'read') handleRead(msg);
      else if (msg.type === 'delete') handleDelete(msg);
      else { renderMessage(msg); if (msg.sender !== myName && msg.id) markRead([msg.id]); }
    } catch (e) { console.error('Parse error:', e); }
  };
  ws.onclose = () => {
    const peer = USERS[myName]?.peer;
    if (peer) { $peerStatus.textContent = 'не в сети'; $peerStatus.className = 'peer-status offline'; }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
  ws.onerror = (err) => console.error('WS error:', err);
  window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'presence', user: myName, online: false }));
  });
}

function sendPresence(extra = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'presence',
      user: myName,
      online: true,
      avatar: localStorage.getItem(myAvatarKey()) || null,
      status: myStatus,
      typing: isTyping,
      ...extra,
    }));
  }
}

function handlePresence(msg) {
  const peer = USERS[myName]?.peer;
  if (msg.user !== peer) return;

  if (msg.avatar) {
    localStorage.setItem(peerAvatarKey(peer), msg.avatar);
    updatePeerAvatar();
  }

  if (msg.status !== undefined) {
    peerStatusData = msg.status;
    if (msg.status) localStorage.setItem(`peer_status_${peer}`, JSON.stringify(msg.status));
    else localStorage.removeItem(`peer_status_${peer}`);
    updatePeerStatusIcon();
  }

  peerIsTyping = !!msg.typing;

  if (msg.online) {
    if (peerIsTyping) {
      $peerStatus.textContent = 'печатает…';
      $peerStatus.className = 'peer-status typing';
    } else {
      $peerStatus.textContent = 'в сети';
      $peerStatus.className = 'peer-status online';
    }
  } else {
    $peerStatus.textContent = formatLastSeen(msg.last_seen);
    $peerStatus.className = 'peer-status offline';
  }

  if (msg.online) sendPresence();
}

function handleRead(msg) {
  if (!msg.ids) return;
  msg.ids.forEach(id => {
    const el = renderedMessages.get(id);
    if (el) { const c = el.querySelector('.read-check'); if (c) c.classList.add('read'); }
  });
}

function handleDelete(msg) {
  const el = renderedMessages.get(msg.id);
  if (el) { el.remove(); renderedMessages.delete(msg.id); }
}

// ==================== ТЕКСТ ====================
function sendText() {
  const text = $input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  isTyping = false;
  clearTimeout(typingTimer);
  sendPresence();

  ws.send(JSON.stringify({ type: 'text', sender: myName, text }));
  $input.value = '';
  $input.focus();
}

function markRead(ids) {
  if (!ids.length || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'read', ids, by: myName }));
}
function markAllRead() {
  const ids = [];
  renderedMessages.forEach((el, id) => { if (el.classList.contains('theirs')) ids.push(id); });
  if (ids.length) markRead(ids);
}

// ==================== ОТРИСОВКА ====================
function renderMessage(msg) {
  if (msg.id && renderedMessages.has(msg.id)) return;
  const isMine = msg.sender === myName;
  const isCircle = msg.type === 'video';
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (isMine ? 'mine' : 'theirs') + (isCircle ? ' circle-wrapper' : '');
  if (msg.id) wrap.dataset.id = msg.id;

  if (msg.type === 'text') wrap.textContent = msg.text || '';
  else if (msg.type === 'voice') wrap.appendChild(buildVoicePlayer(msg, isMine));
  else if (msg.type === 'video') wrap.appendChild(buildCirclePlayer(msg));
  else if (msg.type === 'file') wrap.appendChild(buildFileAttachment(msg));

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
  menu.addEventListener('click', (e) => { e.stopPropagation(); showMessageMenu(msg, wrap); });
  meta.appendChild(menu);
  wrap.appendChild(meta);
  $messages.appendChild(wrap);
  $messages.scrollTop = $messages.scrollHeight;
  if (msg.id) renderedMessages.set(msg.id, wrap);
}

// ==================== ГОЛОСОВОЕ ====================
function buildVoicePlayer(msg, isMine) {
  const mediaUrl = `/media/${encodeURIComponent(msg.mediaKey)}`;
  const box = document.createElement('div');
  box.className = 'voice-msg';
  box.innerHTML = `<button class="play-btn">▶</button><canvas class="wave" width="180" height="28"></canvas><span class="dur">${formatDuration(msg.duration || 0)}</span>`;
  const audio = new Audio(mediaUrl);
  audio.preload = 'metadata';
  const btn = box.querySelector('.play-btn');
  const canvas = box.querySelector('.wave');
  const durEl = box.querySelector('.dur');
  const ctx = canvas.getContext('2d');
  const cMain = isMine ? 'rgba(255,255,255,0.85)' : 'rgba(74,144,226,0.7)';
  const cBg = isMine ? 'rgba(255,255,255,0.35)' : 'rgba(74,144,226,0.25)';
  drawWaveform(ctx, canvas.width, canvas.height, null, cBg);

  let peaks = null;
  fetch(mediaUrl).then(r => r.arrayBuffer()).then(buf => {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    return ac.decodeAudioData(buf);
  }).then(ab => {
    peaks = extractPeaks(ab, 60);
    drawWaveform(ctx, canvas.width, canvas.height, peaks, cMain, peaks, 0);
  }).catch(e => console.warn('Waveform error:', e));

  canvas.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const r = canvas.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  btn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
    else { audio.pause(); btn.textContent = '▶'; }
  });
  audio.addEventListener('ended', () => {
    btn.textContent = '▶';
    if (peaks) drawWaveform(ctx, canvas.width, canvas.height, peaks, cMain, peaks, 0);
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration || !peaks) return;
    drawWaveform(ctx, canvas.width, canvas.height, peaks, cMain, peaks, audio.currentTime / audio.duration);
    durEl.textContent = formatDuration(Math.floor(audio.currentTime));
  });
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && isFinite(audio.duration)) durEl.textContent = formatDuration(Math.floor(audio.duration));
  });
  return box;
}

// ==================== КРУЖОК ====================
function buildCirclePlayer(msg) {
  const box = document.createElement('div');
  box.className = 'circle-msg';
  const size = 180, radius = size / 2 - 3;
  const circ = 2 * Math.PI * radius;
  box.innerHTML = `
    <video src="/media/${encodeURIComponent(msg.mediaKey)}" playsinline muted preload="metadata"></video>
    <svg class="circle-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="4"/>
      <circle class="circle-ring-progress" cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="#4A90E2" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 ${size/2} ${size/2})"/>
    </svg>
    <div class="circle-play-overlay"><svg viewBox="0 0 24 24" width="34" height="34" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>
  `;
  const vid = box.querySelector('video');
  const ring = box.querySelector('.circle-ring-progress');
  const overlay = box.querySelector('.circle-play-overlay');

  vid.addEventListener('loadedmetadata', () => { vid.currentTime = 0.001; overlay.classList.add('visible'); });
  vid.addEventListener('click', (e) => {
    e.stopPropagation();
    if (vid.paused) { vid.muted = false; vid.play(); } else { vid.pause(); }
  });
  vid.addEventListener('play', () => { overlay.classList.remove('visible'); box.classList.add('playing'); });
  vid.addEventListener('pause', () => { if (!vid.ended) overlay.classList.add('visible'); box.classList.remove('playing'); });
  vid.addEventListener('ended', () => {
    overlay.classList.add('visible'); box.classList.remove('playing');
    ring.style.strokeDashoffset = circ; vid.currentTime = 0.001;
  });
  box.addEventListener('click', (e) => {
    if (!vid.duration) return;
    if (e.target === vid || e.target.classList.contains('circle-ring')) {
      const r = box.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let a = Math.atan2(e.clientY - cy, e.clientX - cx) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      vid.currentTime = (a / (2 * Math.PI)) * vid.duration;
    }
  });
  vid.addEventListener('timeupdate', () => {
    if (!vid.duration) return;
    ring.style.strokeDashoffset = circ * (1 - vid.currentTime / vid.duration);
  });
  return box;
}

// ==================== ФАЙЛЫ ====================
function buildFileAttachment(msg) {
  const box = document.createElement('div');
  const url = `/media/${encodeURIComponent(msg.mediaKey)}`;
  const mime = msg.mime || '';
  const name = msg.filename || msg.text || 'файл';

  if (mime.startsWith('image/')) {
    box.innerHTML = `<img src="${url}" alt="${name}" class="attachment">`;
  } else if (mime.startsWith('video/')) {
    box.innerHTML = `<video src="${url}" class="attachment" controls playsinline preload="metadata"></video>`;
  } else if (mime.startsWith('audio/')) {
    box.innerHTML = `<audio src="${url}" controls style="width:100%; max-width: 260px;"></audio>`;
  } else {
    box.innerHTML = `<div class="attachment-info"><span>📎</span><a href="${url}" target="_blank" download="${name}">${name}</a></div>`;
  }
  return box;
}

function sendAttachment(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) return alert('Файл больше 25 МБ');
  const ext = file.name.split('.').pop() || 'bin';
  const bubble = showUploadingBubble(file.name);
  uploadBlobWithProgress(file, ext, (p) => bubble.setProgress(p))
    .then((key) => {
      bubble.remove();
      ws.send(JSON.stringify({
        type: 'file', sender: myName, mediaKey: key,
        mime: file.type || 'application/octet-stream',
        filename: file.name,
      }));
    })
    .catch((e) => { bubble.remove(); alert('Ошибка: ' + e.message); });
}

// ==================== УТИЛИТЫ ====================
function pickMimeType(kind) {
  let c;
  if (kind === 'video') c = IS_IOS
    ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  else c = IS_IOS
    ? ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const t of c) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
  return '';
}

function formatDuration(s) { const m = Math.floor(s/60); const x = Math.floor(s%60).toString().padStart(2,'0'); return `${m}:${x}`; }
function formatTime(ts) { const d = ts ? new Date(ts) : new Date(); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function formatLastSeen(ts) {
  if (!ts) return 'не в сети';
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((now - d) / 60000);
  if (diff < 1) return 'был(а) только что';
  if (diff < 60) return `был(а) ${diff} мин назад`;
  const today = new Date(); today.setHours(0,0,0,0);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (dd.getTime() === today.getTime()) return `был(а) в ${t}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (dd.getTime() === y.getTime()) return `был(а) вчера в ${t}`;
  return `был(а) ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${t}`;
}

function uploadBlobWithProgress(blob, ext, onProgress) {
  return new Promise((resolve, reject) => {
    const key = `media/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/upload/${encodeURIComponent(key)}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded/e.total)*100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(key); else reject(new Error('Upload failed: ' + xhr.status)); };
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.timeout = 120000;
    xhr.send(blob);
  });
}

function showUploadingBubble(label) {
  const w = document.createElement('div');
  w.className = 'msg mine';
  w.innerHTML = `<div class="upload-progress"><div class="upload-label">${label}</div><div class="upload-bar"><div class="upload-fill"></div></div><div class="upload-pct">0%</div></div>`;
  $messages.appendChild(w);
  $messages.scrollTop = $messages.scrollHeight;
  return {
    setProgress: (p) => { w.querySelector('.upload-fill').style.width = p + '%'; w.querySelector('.upload-pct').textContent = p + '%'; },
    remove: () => w.remove(),
  };
}

// ==================== ГС ====================
async function startVoiceRecording() {
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mt = pickMimeType('audio');
    voiceRecorder = new MediaRecorder(voiceStream, mt ? { mimeType: mt, audioBitsPerSecond: 64000 } : {});
    voiceChunks = [];
    voiceRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) voiceChunks.push(e.data); };
    voiceRecorder.onstop = async () => {
      if (voiceStream) { voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; }
      await new Promise(r => setTimeout(r, 200));
      const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/mp4' });
      const dur = Math.round((Date.now() - voiceStartTime) / 1000);
      if (dur < MIN_VOICE_SECONDS) return alert('Минимум 1 сек');
      if (blob.size === 0) return alert('Пустая запись');
      const ext = blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'webm';
      const b = showUploadingBubble('Голосовое');
      try {
        const key = await uploadBlobWithProgress(blob, ext, (p) => b.setProgress(p));
        b.remove();
        ws.send(JSON.stringify({ type: 'voice', sender: myName, mediaKey: key, mime: blob.type, duration: dur }));
      } catch (e) { b.remove(); alert('Ошибка: ' + e.message); }
    };
    voiceStartTime = Date.now();
    voiceRecorder.start(IS_IOS ? 200 : 100);
    $recIndicator.classList.add('active');
    $btnVoice.classList.add('rec');
    voiceTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - voiceStartTime) / 1000);
      $recTime.textContent = formatDuration(sec);
      if (sec >= MAX_VOICE_SECONDS) stopVoiceRecording();
    }, 200);
  } catch (e) { console.error(e); alert('Нет доступа к микрофону'); }
}

function stopVoiceRecording() {
  if (voiceRecorder && voiceRecorder.state === 'recording') { voiceRecorder.requestData(); voiceRecorder.stop(); }
  clearInterval(voiceTimerInterval);
  $recIndicator.classList.remove('active');
  $btnVoice.classList.remove('rec');
}

// ==================== КРУЖОК ЗАПИСЬ ====================
async function startCircleRecording() {
  try {
    circleStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 20, max: 24 } },
      audio: true,
    });
    $circleVideo.srcObject = circleStream;
    $circlePreview.classList.add('active');
    const mt = pickMimeType('video');
    circleRecorder = new MediaRecorder(circleStream, mt ? { mimeType: mt, videoBitsPerSecond: 400000, audioBitsPerSecond: 64000 } : {});
    circleChunks = [];
    circleRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) circleChunks.push(e.data); };
    circleRecorder.onstop = async () => {
      circleStream.getTracks().forEach(t => t.stop());
      $circlePreview.classList.remove('active');
      $circleVideo.srcObject = null;
      await new Promise(r => setTimeout(r, 300));
      const blob = new Blob(circleChunks, { type: circleRecorder.mimeType || 'video/mp4' });
      const dur = Math.round((Date.now() - circleStartTime) / 1000);
      if (blob.size === 0) return alert('Пустая запись');
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const b = showUploadingBubble('Кружок');
      try {
        const key = await uploadBlobWithProgress(blob, ext, (p) => b.setProgress(p));
        b.remove();
        ws.send(JSON.stringify({ type: 'video', sender: myName, mediaKey: key, mime: blob.type, duration: dur }));
      } catch (e) { b.remove(); alert('Ошибка: ' + e.message); }
    };
    circleStartTime = Date.now();
    circleRecorder.start(IS_IOS ? 500 : 100);
    circleTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - circleStartTime) / 1000);
      $circleTimer.textContent = `${formatDuration(sec)} / ${formatDuration(MAX_CIRCLE_SECONDS)}`;
      if (sec >= MAX_CIRCLE_SECONDS) stopCircleRecording();
    }, 200);
  } catch (e) { console.error(e); alert('Нет доступа к камере: ' + e.message); if (circleStream) circleStream.getTracks().forEach(t => t.stop()); $circlePreview.classList.remove('active'); }
}

function stopCircleRecording() {
  if (circleRecorder && circleRecorder.state === 'recording') { circleRecorder.requestData(); circleRecorder.stop(); }
  clearInterval(circleTimerInterval);
}

// ==================== МЕНЮ ====================
function showMessageMenu(msg, wrap) {
  document.querySelectorAll('.msg-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'msg-popup';
  popup.innerHTML = `<button data-action="delete-me">Удалить у себя</button><button data-action="delete-all">Удалить у обоих</button>`;
  popup.querySelector('[data-action="delete-me"]').onclick = () => { ws.send(JSON.stringify({ type: 'delete', id: msg.id, forAll: false, by: myName })); popup.remove(); };
  popup.querySelector('[data-action="delete-all"]').onclick = () => { ws.send(JSON.stringify({ type: 'delete', id: msg.id, forAll: true, by: myName })); popup.remove(); };
  document.body.appendChild(popup);
  const r = wrap.getBoundingClientRect();
  popup.style.cssText = `position:fixed; top:${r.bottom+5}px; left:${Math.max(10,r.left)}px; z-index:300;`;
  setTimeout(() => {
    document.addEventListener('click', function cl(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', cl); }
    });
  }, 10);
}

// ==================== ВОЛНА ====================
function extractPeaks(ab, count) {
  const raw = ab.getChannelData(0);
  const bs = Math.floor(raw.length / count);
  const peaks = [];
  for (let i = 0; i < count; i++) {
    let s = 0;
    for (let j = 0; j < bs; j++) s += Math.abs(raw[i * bs + j]);
    peaks.push(s / bs);
  }
  const m = Math.max(...peaks) || 1;
  return peaks.map(p => p / m);
}
function drawWaveform(ctx, w, h, peaks, color, _, progress) {
  ctx.clearRect(0, 0, w, h);
  const bars = peaks ? peaks.length : 60;
  const bw = 2;
  const gap = (w - bars * bw) / (bars - 1);
  const mid = h / 2;
  for (let i = 0; i < bars; i++) {
    const p = peaks ? peaks[i] : 0.4;
    const bh = Math.max(2, p * (h - 4));
    const x = i * (bw + gap);
    const played = progress != null && (i / bars) < progress;
    ctx.fillStyle = played ? (color.includes('255') ? 'rgba(255,255,255,1)' : 'rgba(74,144,226,1)') : color;
    ctx.fillRect(x, mid - bh / 2, bw, bh);
  }
}

// ==================== ПРОФИЛЬ ====================
function openProfile() {
  $profileName.value = myName;
  $profileEmail.value = profile.email;
  const myAv = localStorage.getItem(myAvatarKey());
  if (myAv) { $avatarImg.src = `/media/${encodeURIComponent(myAv)}`; $avatarImg.classList.add('loaded'); }
  else { $avatarImg.classList.remove('loaded'); $avatarImg.src = ''; }
  $profileModal.classList.add('active');
}
function closeProfile() { $profileModal.classList.remove('active'); }
async function saveProfile() {
  myName = $profileName.value.trim() || myName;
  profile.email = $profileEmail.value.trim();
  localStorage.setItem(`email_${myName}`, profile.email);
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
      method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file,
    });
    if (!res.ok) throw new Error('Upload failed');
    localStorage.setItem(myAvatarKey(), key);
    const url = `/media/${encodeURIComponent(key)}`;
    $avatarImg.src = url; $avatarImg.classList.add('loaded');
    $headerAvatar.src = url; $headerAvatar.classList.add('loaded');
    if (ws && ws.readyState === WebSocket.OPEN) sendPresence();
  } catch (e) { console.error(e); alert('Не удалось загрузить'); }
}

// ==================== СТАТУСЫ ====================
function setMyStatus(emoji, text) {
  myStatus = emoji ? { emoji, text: text || '' } : null;
  if (myStatus) {
    localStorage.setItem(`status_${myName}`, JSON.stringify(myStatus));
    if (myStatus.emoji) addToStatusHistory(myStatus);
  } else {
    localStorage.removeItem(`status_${myName}`);
  }
  if (ws && ws.readyState === WebSocket.OPEN) sendPresence();
  closeStatusModal();
  closeEmojiModal();
}

function getStatusHistory() {
  try { return JSON.parse(localStorage.getItem(`status_history_${myName}`) || '[]'); }
  catch (e) { return []; }
}

function addToStatusHistory(status) {
  if (!status || !status.emoji) return;
  const history = getStatusHistory();
  const filtered = history.filter(s => !(s.emoji === status.emoji && s.text === status.text));
  filtered.unshift(status);
  const limited = filtered.slice(0, 10);
  localStorage.setItem(`status_history_${myName}`, JSON.stringify(limited));
  renderStatusHistory();
}

function renderStatusHistory() {
  const history = getStatusHistory();
  if (history.length === 0) { $recentStatusesBlock.style.display = 'none'; return; }
  $recentStatusesBlock.style.display = 'block';
  $recentStatuses.innerHTML = '';
  history.forEach(s => {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.innerHTML = `<span class="recent-emoji">${s.emoji}</span><span class="recent-text">${s.text}</span>`;
    b.onclick = () => setMyStatus(s.emoji, s.text);
    $recentStatuses.appendChild(b);
  });
}

function updatePeerStatusIcon() {
  if (peerStatusData && peerStatusData.emoji) {
    $peerStatusIcon.hidden = false;
    $peerStatusIcon.textContent = peerStatusData.emoji;
  } else $peerStatusIcon.hidden = true;
}
function showStatusTooltip() {
  if (!peerStatusData || !peerStatusData.text) return;
  $statusTooltip.textContent = peerStatusData.text;
  const r = $peerStatusIcon.getBoundingClientRect();
  $statusTooltip.style.top = (r.bottom + 8) + 'px';
  $statusTooltip.style.left = Math.max(10, r.left - 80) + 'px';
  $statusTooltip.classList.add('visible');
  setTimeout(() => $statusTooltip.classList.remove('visible'), 3000);
}
function openStatusModal() { renderStatusHistory(); $statusModal.classList.add('active'); }
function closeStatusModal() { $statusModal.classList.remove('active'); }
function openEmojiModal() {
  $emojiScroll.innerHTML = '';
  EMOJI_LIBRARY.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e;
    if (e === selectedEmoji) b.classList.add('selected');
    b.onclick = () => {
      selectedEmoji = e;
      $emojiCurrent.textContent = e;
      $emojiScroll.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    };
    $emojiScroll.appendChild(b);
  });
  $emojiCurrent.textContent = selectedEmoji;
  $emojiDesc.value = '';
  $emojiModal.classList.add('active');
}
function closeEmojiModal() { $emojiModal.classList.remove('active'); }

// ==================== TYPING ====================
function onTyping() {
  if (!isTyping) {
    isTyping = true;
    sendPresence();
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    sendPresence();
  }, 2000);
}

// ==================== СОБЫТИЯ ====================
$btnSend.addEventListener('click', sendText);
$input.addEventListener('input', onTyping);
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendText(); }
  else { onTyping(); }
});

$btnAttach.addEventListener('click', () => $fileInput.click());
$fileInput.addEventListener('change', (e) => {
  Array.from(e.target.files).forEach(sendAttachment);
  e.target.value = '';
});
$btnEmoji.addEventListener('click', openEmojiModal);
$closeEmoji.addEventListener('click', closeEmojiModal);
$emojiModal.addEventListener('click', (e) => { if (e.target === $emojiModal) closeEmojiModal(); });
$saveEmoji.addEventListener('click', () => {
  const d = $emojiDesc.value.trim();
  if (!d) return alert('Напишите описание');
  setMyStatus(selectedEmoji, d);
});

$peerStatusIcon.addEventListener('click', showStatusTooltip);
$btnProfile.addEventListener('click', openProfile);
$closeProfile.addEventListener('click', closeProfile);
$saveProfile.addEventListener('click', saveProfile);
$avatarInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) uploadAvatar(f); e.target.value = ''; });
$profileModal.addEventListener('click', (e) => { if (e.target === $profileModal) closeProfile(); });
$openStatusFromProfile.addEventListener('click', () => { closeProfile(); openStatusModal(); });
$closeStatus.addEventListener('click', closeStatusModal);
$statusModal.addEventListener('click', (e) => { if (e.target === $statusModal) closeStatusModal(); });
$clearStatus.addEventListener('click', () => setMyStatus(null));
document.querySelectorAll('.status-item').forEach(btn => {
  btn.addEventListener('click', () => setMyStatus(btn.dataset.emoji, btn.dataset.text));
});

$btnVoice.addEventListener('mousedown', (e) => { e.preventDefault(); startVoiceRecording(); });
$btnVoice.addEventListener('mouseup', stopVoiceRecording);
$btnVoice.addEventListener('mouseleave', stopVoiceRecording);
$btnVoice.addEventListener('touchstart', (e) => { e.preventDefault(); startVoiceRecording(); }, { passive: false });
$btnVoice.addEventListener('touchend', (e) => { e.preventDefault(); stopVoiceRecording(); }, { passive: false });

$btnCircle.addEventListener('click', startCircleRecording);
$circleCancel.addEventListener('click', () => {
  if (circleRecorder && circleRecorder.state === 'recording') { circleRecorder.onstop = null; circleRecorder.stop(); }
  if (circleStream) circleStream.getTracks().forEach(t => t.stop());
  clearInterval(circleTimerInterval);
  $circlePreview.classList.remove('active');
});
$circleSend.addEventListener('click', stopCircleRecording);

// ==================== СТАРТ ====================
showLogin();