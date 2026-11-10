import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/CSS3DRenderer.js';
import { buildHall, ROWS, COLS, SCREEN, eyeFor, seatLabel } from './hall.js';
import { parseYouTube } from './parse.js';

const DEFAULT_VIDEO = { id: 'aqz-KE-bpKQ', list: null };
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('cinema.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cinema.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

let needDraw = true; // the hall is drawn only when something changed

/* ---------------- three.js setup ---------------- */
const glCanvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: (window.devicePixelRatio || 1) <= 1, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(55, 1, 0.05, 80);
const hall = buildHall(scene);

const cssRenderer = new CSS3DRenderer();
$('#css-layer').appendChild(cssRenderer.domElement);
const cssScene = new THREE.Scene();
const ytWrap = document.createElement('div');
ytWrap.id = 'yt-wrap';
ytWrap.innerHTML = '<div id="yt"></div>';
const cssObj = new CSS3DObject(ytWrap);
cssObj.position.set(0, SCREEN.cy, 0);
cssObj.scale.setScalar(SCREEN.w / 1280);
cssScene.add(cssObj);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  glCanvas.style.width = w + 'px'; glCanvas.style.height = h + 'px';
  cssRenderer.setSize(w, h);
  cam.aspect = w / h;
  // keep roughly 80 degrees across on tall phones, capped so it does not turn into a fisheye
  const vf = 2 * Math.atan(Math.tan((80 * Math.PI) / 360) / cam.aspect) * 180 / Math.PI;
  cam.fov = clamp(vf, 55, 100);
  cam.updateProjectionMatrix();
  needDraw = true;
}
addEventListener('resize', resize);
resize();

/* ---------------- camera rig ---------------- */
const rowLetter = (i) => String.fromCharCode(65 + i);
function poseLook(pos, target) {
  const d = target.clone().sub(pos);
  return { pos: pos.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
const lobbyPose = () => {
  const p = poseLook(new THREE.Vector3(0, 6.4, 16.8), new THREE.Vector3(0, 2.0, 6.5));
  if (cam.aspect < 0.8) p.pitch -= 0.52; // phones: the sheet covers the lower part, so aim low
  return p;
};
const LOBBY = lobbyPose();
const seatPose = (i, j) => poseLook(eyeFor(i, j), new THREE.Vector3(0, SCREEN.cy, 0));
let view = { pos: LOBBY.pos.clone(), yaw: LOBBY.yaw, pitch: LOBBY.pitch };
let fly = null;
addEventListener('resize', () => { if (typeof mode !== 'undefined' && mode === 'lobby' && !fly) view.pitch = lobbyPose().pitch; });
const look = { yaw: 0, pitch: 0 };
const lookT = { yaw: 0, pitch: 0 };
const LIM = { yaw: (70 * Math.PI) / 180, up: (30 * Math.PI) / 180, down: (30 * Math.PI) / 180 };
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function flyTo(pose, dur = 1.8) {
  if (reduced) dur = 0.3;
  fly = { from: { pos: view.pos.clone(), yaw: view.yaw, pitch: view.pitch }, to: pose, t: 0, dur };
  lookT.yaw = lookT.pitch = 0;
}
function recenter() { lookT.yaw = lookT.pitch = 0; }

function updateCamera(dt, t) {
  if (fly) {
    fly.t += dt;
    const u = clamp(fly.t / fly.dur, 0, 1), e = ease(u);
    view.pos.lerpVectors(fly.from.pos, fly.to.pos, e);
    view.pos.y += Math.sin(Math.PI * e) * 0.9;
    view.yaw = fly.from.yaw + angleDiff(fly.from.yaw, fly.to.yaw) * e;
    view.pitch = fly.from.pitch + (fly.to.pitch - fly.from.pitch) * e;
    if (u >= 1) { view = { pos: fly.to.pos.clone(), yaw: fly.to.yaw, pitch: fly.to.pitch }; fly = null; }
  }
  const k = 1 - Math.exp(-dt * 10);
  look.yaw += (lookT.yaw - look.yaw) * k;
  look.pitch += (lookT.pitch - look.pitch) * k;
  const sway = 0; // no idle sway: a still viewer costs no drawing
  cam.position.copy(view.pos);
  cam.position.y += sway * Math.sin(t * 0.7) * 0.012;
  cam.position.x += sway * Math.sin(t * 0.43 + 1) * 0.008;
  cam.rotation.set(view.pitch + look.pitch + sway * Math.sin(t * 0.55) * 0.0035, view.yaw + look.yaw + sway * Math.sin(t * 0.37) * 0.0025, 0, 'YXZ');
}

/* ---------------- UI state ---------------- */
const kiosk = $('#kiosk');
const bar = $('#bar');
const noticeEl = $('#notice');
const msgEl = $('#video-msg');
let seat = null;           // {i, j}
let mode = 'lobby';        // lobby | seated
let lightsState = 'idle';  // idle | play | pause | end
let lastActive = performance.now();
let glow = 0.5;
const activity = () => { lastActive = performance.now(); };

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="s" d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="s" d="M16 9l5 6M21 9l-5 6"/></svg>',
  fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  fsx: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};
const bPlay = $('#b-play'), bMute = $('#b-mute'), bFs = $('#b-fs'), bSeat = $('#b-seat'), bVideo = $('#b-video');
bPlay.innerHTML = ICON.play; bMute.innerHTML = ICON.vol; bFs.innerHTML = ICON.fs;
if (!document.fullscreenEnabled) bFs.hidden = true;

const noticeText = $('#notice-text'), noticeOpen = $('#n-open'), noticeTry = $('#n-try');
function setNotice(text, { videoUrl = null, actions = false } = {}) {
  noticeEl.hidden = !text;
  noticeText.textContent = text || '';
  noticeOpen.hidden = !(actions && videoUrl);
  if (videoUrl) noticeOpen.href = videoUrl;
  noticeTry.hidden = !actions;
  noticeEl.querySelector('.acts').hidden = !actions;
  if (text) activity();
}
noticeTry.addEventListener('click', () => { setNotice(''); openKiosk('video'); });
function setMsg(text) { msgEl.textContent = text || ''; }

/* ---------------- kiosk (seat map + video panel) ---------------- */
const rowsEl = $('#seat-rows');
const seatBtns = [];
for (let i = 0; i < ROWS; i++) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('span');
  lab.className = 'rl'; lab.textContent = rowLetter(i);
  row.appendChild(lab);
  for (let j = 0; j < COLS; j++) {
    if (j === COLS / 2) { const g = document.createElement('span'); g.className = 'gap'; row.appendChild(g); }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seat'; b.textContent = String(j + 1);
    b.setAttribute('aria-label', seatLabel(i, j));
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => selectSeat(i, j));
    row.appendChild(b); seatBtns.push(b);
  }
  rowsEl.appendChild(row);
}

let kioskView = 'seats';
function openKiosk(view_ = 'seats') {
  kioskView = view_;
  kiosk.hidden = false;
  kiosk.dataset.mode = mode === 'lobby' ? 'lobby' : view_;
  activity();
  const target = view_ === 'video' && mode !== 'lobby' ? $('#video-input') : (seat ? seatBtns[seat.i * COLS + seat.j] : seatBtns[3 * COLS + 5]);
  setTimeout(() => target.focus({ preventScroll: true }), 30);
}
function closeKiosk() {
  if (mode === 'lobby') return;
  kiosk.hidden = true;
  document.activeElement?.blur?.();
}
$('#kiosk-close').addEventListener('click', closeKiosk);
bSeat.addEventListener('click', () => (kiosk.hidden || kioskView !== 'seats' ? openKiosk('seats') : closeKiosk()));
bVideo.addEventListener('click', () => (kiosk.hidden || kioskView !== 'video' ? openKiosk('video') : closeKiosk()));

function selectSeat(i, j, { instant = false, quiet = false } = {}) {
  const wasLobby = mode === 'lobby';
  seat = { i, j };
  store.set('seat', { i, j });
  seatBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i * COLS + j)));
  hall.setSelected(i * COLS + j); needDraw = true;
  if (audienceOn) hall.setAudience(true, i * COLS + j);
  bSeat.textContent = seatLabel(i, j);
  pushVol();
  const pose = seatPose(i, j);
  if (instant) { view = { pos: pose.pos.clone(), yaw: pose.yaw, pitch: pose.pitch }; fly = null; lookT.yaw = lookT.pitch = 0; look.yaw = look.pitch = 0; }
  else flyTo(pose);
  mode = 'seated'; document.body.dataset.mode = 'seated';
  if (!quiet) {
    kiosk.hidden = true;
    document.activeElement?.blur?.();
    showHint();
  }
  if (wasLobby && !quiet) startPlayback();
}

/* ---------------- audience ---------------- */
let audienceOn = !!store.get('audience', false);
const bAud = $('#btn-audience');
function applyAudience() {
  bAud.setAttribute('aria-pressed', String(audienceOn));
  bAud.textContent = 'Audience: ' + (audienceOn ? 'some' : 'empty');
  hall.setAudience(audienceOn, seat ? seat.i * COLS + seat.j : -1); needDraw = true;
  store.set('audience', audienceOn);
}
const bHall = $('#btn-hall');
function applyHall() {
  bHall.setAttribute('aria-pressed', String(hallSound));
  bHall.textContent = 'Hall sound: ' + (hallSound ? 'on' : 'off');
  store.set('hall', hallSound);
  pushVol();
}
bHall.addEventListener('click', () => { hallSound = !hallSound; applyHall(); });
// "YouTube menu": clicks go straight to the YouTube player on the screen (gear menu: quality, speed, subtitles)
const bYt = $('#btn-yt');
let ytDirect = false;
function applyYt() {
  bYt.setAttribute('aria-pressed', String(ytDirect));
  bYt.textContent = 'YouTube menu: ' + (ytDirect ? 'on' : 'off');
  document.body.classList.toggle('yt-direct', ytDirect);
  if (ytDirect) recenter();
}
bYt.addEventListener('click', () => { ytDirect = !ytDirect; applyYt(); });

/* ---------------- sound booth link: real picture light and 3D sound ---------------- */
// The booth window captures this tab (with permission). It sends back the real colours of the
// film picture, and it needs to know where the viewer sits and looks for the 3D sound.
const chan = 'BroadcastChannel' in window ? new BroadcastChannel('cinema-room') : null;
const bReal = $('#btn-real');
let realCols = null, realAt = 0, boothOn = false, poseDirty = true;
function setBooth(on) {
  boothOn = on; if (!on) realCols = null;
  bReal.setAttribute('aria-pressed', String(on));
  bReal.textContent = on ? '3D sound and real light: on' : '3D sound and real light';
  poseDirty = true; needDraw = true;
}
if (chan) chan.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'hello') setBooth(true);
  else if (m.type === 'bye') setBooth(false);
  else if (m.type === 'nocols') { realCols = null; needDraw = true; }
  else if (m.type === 'cols') { realCols = m.cols; realAt = performance.now(); needDraw = true; }
};
bReal.hidden = !chan || !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
bReal.addEventListener('click', () => { window.open('booth.html', 'cinema-booth', 'popup,width=440,height=600'); });
const corner = new THREE.Vector3(), fwd = new THREE.Vector3();
function sendPose() {
  if (!chan || !boothOn) return;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    corner.set(sx * SCREEN.w / 2, SCREEN.cy + sy * SCREEN.h / 2, 0).project(cam);
    const u = clamp((corner.x + 1) / 2, 0, 1), v = clamp((1 - corner.y) / 2, 0, 1);
    x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  cam.getWorldDirection(fwd);
  chan.postMessage({ type: 'pose', pos: [cam.position.x, cam.position.y, cam.position.z], dir: [fwd.x, fwd.y, fwd.z], rect: [x0, y0, x1, y1] });
}
setInterval(() => { poseDirty = true; if (boothOn) needDraw = true; }, 2000);

// tint for the simple glow: the average colour of the video thumbnail
function loadTint(id) {
  if (!id) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 4;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 4, 4);
      const d = g.getImageData(0, 0, 4, 4).data; let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const k = 1 / (16 * 255), m = Math.max(r, gg, b) * k || 1;
      hall.setTint(Math.min(1, (r * k) / m * 0.85 + 0.1), Math.min(1, (gg * k) / m * 0.85 + 0.1), Math.min(1, (b * k) / m * 0.85 + 0.1));
      needDraw = true;
    } catch { /* keep the default tint */ }
  };
  img.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/mqdefault.jpg';
}
bAud.addEventListener('click', () => { audienceOn = !audienceOn; applyAudience(); });

/* ---------------- hint ---------------- */
let hintTimer = 0;
function showHint() {
  const h = $('#hint');
  h.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => h.classList.remove('on'), 6000);
}

/* ---------------- YouTube player ---------------- */
let player = null, ready = false, pending = null, current = null, pState = -2, playerFailed = false;
const recent = store.get('recent', []);

function loadYT() {
  return new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => rej(new Error('blocked'));
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('timeout')), 20000);
  });
}

function applyVideo(p, autoplay) {
  if (!ready) { pending = { p, autoplay }; return; }
  current = p;
  if (p.id) {
    if (autoplay) player.loadVideoById(p.id); else player.cueVideoById(p.id);
  } else {
    const o = { list: p.list, listType: 'playlist', index: 0 };
    if (autoplay) player.loadPlaylist(o); else player.cuePlaylist(o);
  }
}

function startVideo(p, autoplay) {
  current = p; lastError = null; wantPlay = autoplay; loadTint(p.id);
  setNotice('');
  applyVideo(p, autoplay);
}

let startAt = 0; // seconds, from a ?t= link
let wantPlay = false; // a play request that arrived while a cue was still loading
function startPlayback() {
  wantPlay = true;
  if (ready) { try { player.playVideo(); } catch { /* player not usable */ } } else if (pending) pending.autoplay = true; else playAfterReady = true;
}
let playAfterReady = false;

const OWNER = 'The owner of this video does not allow it to play outside youtube.com.';
const ERR = {
  2: 'This video id is not valid. Check the link and try again.',
  5: 'The player hit a problem playing this video. Try another one.',
  100: 'YouTube says this video was not found. It may be private or removed.',
  101: OWNER,
  150: OWNER,
  153: 'YouTube refused to show this video here because it could not verify the page it is embedded in. Open it on YouTube instead.',
};
let lastError = null;
function watchUrl() {
  let id = current && current.id;
  try { const d = player && player.getVideoData && player.getVideoData(); if (d && d.video_id) id = d.video_id; } catch { /* ignore */ }
  if (id) return 'https://www.youtube.com/watch?v=' + id;
  return current && current.list ? 'https://www.youtube.com/playlist?list=' + current.list : 'https://www.youtube.com/';
}

function onState(e) {
  pState = e.data;
  const S = window.YT.PlayerState;
  if (pState === S.PLAYING) lightsState = 'play';
  else if (pState === S.PAUSED) lightsState = 'pause';
  else if (pState === S.ENDED) lightsState = 'end';
  else if (pState === S.BUFFERING) { if (lightsState === 'idle' || lightsState === 'end') lightsState = 'play'; }
  else lightsState = 'idle';
  if (lightsState === 'play') lastActive = performance.now() - 1000;
  bPlay.innerHTML = lightsState === 'play' ? ICON.pause : ICON.play;
  bPlay.setAttribute('aria-label', lightsState === 'play' ? 'Pause' : 'Play');
  if (pState === S.CUED && wantPlay) player.playVideo();
  if (pState === S.PLAYING) { wantPlay = false; if (startAt > 0) { const s0 = startAt; startAt = 0; player.seekTo(s0, true); } }
  if (pState === S.CUED || pState === S.PLAYING) { rememberTitle(); lastError = null; setNotice(''); }
  syncVolume();
}

function rememberTitle() {
  try {
    const d = player.getVideoData();
    if (!d || !d.video_id) return;
    const entry = recent.find((r) => r.id === d.video_id) || (current && current.id === d.video_id ? addRecent(current) : null);
    if (entry && d.title && entry.title !== d.title) { entry.title = d.title; store.set('recent', recent); renderRecent(); }
  } catch { /* ignore */ }
}

async function initPlayer() {
  try { await loadYT(); } catch {
    playerFailed = true;
    setNotice('Could not reach YouTube. Check your connection and reload the page.');
    return;
  }
  const first = pending ? pending.p : current;
  const q = new URLSearchParams({ enablejsapi: '1', origin: location.origin, controls: '1', disablekb: '1', modestbranding: '1', rel: '0', playsinline: '1', iv_load_policy: '3', fs: '0' });
  const ifr = document.createElement('iframe');
  ifr.id = 'yt';
  ifr.title = 'YouTube video player';
  ifr.src = first.id ? `https://www.youtube.com/embed/${first.id}?${q}` : (q.set('listType', 'playlist'), q.set('list', first.list), `https://www.youtube.com/embed/videoseries?${q}`);
  ifr.referrerPolicy = 'strict-origin-when-cross-origin';
  ifr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  ifr.setAttribute('frameborder', '0');
  $('#yt').replaceWith(ifr);
  pending = null;
  player = new window.YT.Player(ifr, {
    events: {
      onReady: () => {
        ready = true;
        pushVol();
        syncVolume();
        const p = pending; pending = null;
        if (p) applyVideo(p.p, p.autoplay);
        if (playAfterReady) { playAfterReady = false; player.playVideo(); }
      },
      onStateChange: onState,
      onError: (e) => {
        lastError = e.data; wantPlay = false;
        console.info('YouTube player error code', e.data, 'for', watchUrl());
        let msg = ERR[e.data] || 'This video could not be played.';
        // many music videos refuse to play on a bare IP or localhost address, but play from a host name
        const bareHost = /^(127.0.0.1|localhost)$/.test(location.hostname);
        if ((e.data === 150 || e.data === 101) && bareHost) {
          location.replace('http://cinema.localtest.me:' + location.port + '/?v=' + encodeURIComponent(current && current.id || ''));
          return;
        }
        setNotice(`${msg} (error ${e.data})`, { videoUrl: watchUrl(), actions: [100, 101, 150, 153].includes(e.data) });
        lightsState = 'idle';
        bPlay.innerHTML = ICON.play;
      },
    },
  });
}

function togglePlay() {
  if (!ready) return;
  const S = window.YT.PlayerState;
  if (pState === S.PLAYING || pState === S.BUFFERING && lightsState === 'play') player.pauseVideo();
  else if (pState === S.ENDED) { player.seekTo(0, true); player.playVideo(); }
  else player.playVideo();
}
function seekBy(d) {
  if (!ready) return;
  const dur = player.getDuration() || 0;
  player.seekTo(clamp(player.getCurrentTime() + d, 0, dur || 1e9), true);
}
// "Hall sound" only scales the player volume a little by row (front louder, back softer).
// The film audio comes from a cross-origin YouTube iframe, so there is no real 3D sound.
let userVol = store.get('vol', 100);
let hallSound = !!store.get('hall', false);
const seatGain = () => (hallSound && seat ? 1 - 0.4 * (seat.i / (ROWS - 1)) : 1);
function pushVol() { if (ready) player.setVolume(Math.round(userVol * seatGain())); }
function setUserVol(v) { userVol = v; store.set('vol', v); pushVol(); syncVolume(); }
function volBy(d) {
  if (!ready) return;
  const v = clamp((player.isMuted() ? 0 : userVol) + d, 0, 100);
  if (v > 0 && player.isMuted()) player.unMute();
  setUserVol(v);
}

const seekEl = $('#seek'), volEl = $('#vol'), tCur = $('#t-cur'), tDur = $('#t-dur');
let scrubbing = false;
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};
function syncVolume() {
  if (!ready) return;
  const muted = player.isMuted();
  const v = muted ? 0 : userVol;
  volEl.value = v;
  bMute.innerHTML = muted || v === 0 ? ICON.mute : ICON.vol;
  bMute.setAttribute('aria-label', muted || v === 0 ? 'Unmute' : 'Mute');
}
function syncTime() {
  if (!ready || scrubbing) return;
  let t = 0, d = 0;
  try { t = player.getCurrentTime(); d = player.getDuration(); } catch { return; }
  tCur.textContent = fmt(t);
  tDur.textContent = d ? fmt(d) : 'Live';
  seekEl.value = d ? Math.round((t / d) * 1000) : 0;
  seekEl.style.setProperty('--p', (d ? (t / d) * 100 : 0) + '%');
}
setInterval(syncTime, 250);
seekEl.addEventListener('input', () => {
  scrubbing = true;
  const d = ready ? player.getDuration() : 0;
  tCur.textContent = fmt((seekEl.value / 1000) * d);
  seekEl.style.setProperty('--p', seekEl.value / 10 + '%');
});
seekEl.addEventListener('change', () => {
  if (ready) player.seekTo((seekEl.value / 1000) * (player.getDuration() || 0), true);
  scrubbing = false;
});
volEl.addEventListener('input', () => {
  if (!ready) return;
  const v = +volEl.value;
  if (player.isMuted() && v > 0) player.unMute();
  setUserVol(v);
});
bPlay.addEventListener('click', togglePlay);
bMute.addEventListener('click', () => {
  if (!ready) return;
  if (player.isMuted() || userVol === 0) { player.unMute(); if (userVol === 0) setUserVol(60); } else player.mute();
  syncVolume();
});

/* ---------------- fullscreen ---------------- */
function toggleFs() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}
bFs.addEventListener('click', toggleFs);
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  bFs.innerHTML = on ? ICON.fsx : ICON.fs;
  bFs.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  resize();
});

/* ---------------- video form and recent ---------------- */
function addRecent(p) {
  const key = (r) => (r.id || '') + '|' + (r.list || '');
  let entry = recent.find((r) => key(r) === key(p));
  if (entry) recent.splice(recent.indexOf(entry), 1); else entry = { id: p.id, list: p.list, title: '' };
  recent.unshift(entry);
  recent.length = Math.min(recent.length, 6);
  store.set('recent', recent);
  renderRecent();
  return entry;
}
function renderRecent() {
  const box = $('#recent');
  box.textContent = '';
  $('#recent-wrap').hidden = recent.length === 0;
  for (const r of recent) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    b.textContent = r.title || (r.id ? r.id : 'Playlist ' + r.list);
    b.title = b.textContent;
    b.addEventListener('click', () => submitVideo(r.id ? 'https://youtu.be/' + r.id : 'https://www.youtube.com/playlist?list=' + r.list));
    box.appendChild(b);
  }
}
function submitVideo(raw) {
  const p = parseYouTube(raw);
  if (!p) { setMsg('That does not look like a YouTube link or video id. Try a link such as youtube.com/watch?v=...'); return false; }
  setMsg('');
  addRecent(p);
  startVideo(p, mode !== 'lobby');
  if (mode !== 'lobby') closeKiosk();
  else setMsg('Loaded. Pick a seat to start the film.');
  $('#video-input').value = '';
  return true;
}
$('#video-form').addEventListener('submit', (e) => { e.preventDefault(); submitVideo($('#video-input').value); });

/* ---------------- pointer: look around, click seats ---------------- */
const stage = $('#stage');
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ptr = { x: 0, y: 0, dirty: false, inside: false };
let drag = null;
const tip = $('#tip');

function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const hits = ray.intersectObjects([hall.cushion, hall.back, hall.hole], false);
  return hits[0] || null;
}
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  stage.setPointerCapture(e.pointerId);
  activity();
});
stage.addEventListener('pointermove', (e) => {
  activity();
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.dirty = true; ptr.inside = true;
  if (drag && e.pointerId === drag.id) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { drag.moved = true; stage.classList.add('dragging'); }
    if (drag.moved) {
      const k = (cam.fov * Math.PI) / 180 / innerHeight;
      lookT.yaw = clamp(lookT.yaw + (e.clientX - drag.x) * k, -LIM.yaw, LIM.yaw);
      lookT.pitch = clamp(lookT.pitch + (e.clientY - drag.y) * k, -LIM.down, LIM.up);
      look.yaw = lookT.yaw; look.pitch = lookT.pitch; // follow the finger exactly while dragging
      tip.hidden = true;
    }
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null; stage.classList.remove('dragging');
  if (!moved && e.type === 'pointerup') {
    const h = pick(e.clientX, e.clientY);
    if (h) {
      if (h.object === hall.hole) { if (mode === 'seated') togglePlay(); }
      else if (h.instanceId != null) selectSeat(Math.floor(h.instanceId / COLS), h.instanceId % COLS);
    }
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { ptr.inside = false; hall.setHover(-1); tip.hidden = true; });
stage.addEventListener('dblclick', recenter);

function updateHover() {
  if (!ptr.dirty) return;
  ptr.dirty = false;
  if (drag && drag.moved) { hall.setHover(-1); return; }
  const h = pick(ptr.x, ptr.y);
  const isSeat = h && h.instanceId != null;
  hall.setHover(isSeat ? h.instanceId : -1);
  stage.classList.toggle('pointing', !!h);
  if (isSeat) {
    const i = Math.floor(h.instanceId / COLS), j = h.instanceId % COLS;
    tip.textContent = seatLabel(i, j);
    tip.style.transform = `translate(${Math.min(ptr.x + 14, innerWidth - 150)}px, ${ptr.y + 16}px)`;
    tip.hidden = false;
  } else tip.hidden = true;
}

/* ---------------- keyboard ---------------- */
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.matches('input[type="text"], textarea')) { if (e.key === 'Escape') t.blur(); return; }
  const onRange = t.matches('input[type="range"]');
  activity();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case ' ':
      if (t.matches('button')) return;
      e.preventDefault(); if (mode === 'seated') togglePlay(); break;
    case 'ArrowLeft': if (!onRange && mode === 'seated') { e.preventDefault(); seekBy(-5); } break;
    case 'ArrowRight': if (!onRange && mode === 'seated') { e.preventDefault(); seekBy(5); } break;
    case 'ArrowUp': if (!onRange && mode === 'seated') { e.preventDefault(); volBy(5); } break;
    case 'ArrowDown': if (!onRange && mode === 'seated') { e.preventDefault(); volBy(-5); } break;
    case 'f': toggleFs(); break;
    case 's': if (mode === 'seated') (kiosk.hidden || kioskView !== 'seats' ? openKiosk('seats') : closeKiosk()); break;
    case 'c': recenter(); break;
    case 'Escape': if (ytDirect) { ytDirect = false; applyYt(); } closeKiosk(); break;
    default:
  }
});
addEventListener('pointerdown', activity, true);
addEventListener('touchstart', activity, { passive: true, capture: true });

/* ---------------- main loop ---------------- */
const houseFor = () => {
  if (mode === 'lobby') return 1;
  return { idle: 0.75, play: 0, pause: 0.4, end: 0.55 }[lightsState];
};
const glowFor = () => ({ idle: 0.45, play: 1, pause: 0.3, end: 0.15 }[lightsState]);
let house = 1, last = performance.now();
let uiIdle = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  house += (houseFor() - house) * (1 - Math.exp(-dt / 1.0)); // about 3 s to settle
  glow += (glowFor() - glow) * (1 - Math.exp(-dt / 0.8));
  updateCamera(dt, t);
  updateHover();
  // draw only on change: camera moved, lights still fading, hover changed, or the slow glow tick
  const sig = cam.position.x + cam.position.y * 3.1 + cam.position.z * 7.3 + cam.rotation.x * 11.7 + cam.rotation.y * 17.9 + cam.fov * 0.013;
  const fading = Math.abs(houseFor() - house) > 0.004 || Math.abs(glowFor() - glow) > 0.004;
  const glowTick = glow > 0.05 && now - lastGlow > 400;
  if (sig !== lastSig) poseDirty = true;
  if (realCols && now - realAt > 1500) realCols = null; // booth went quiet
  if (sig !== lastSig || fading || (glowTick && !realCols) || hall.hover !== lastHover) needDraw = true;
  lastSig = sig; lastHover = hall.hover;
  const idle = !ytDirect && lightsState === 'play' && mode === 'seated' && kiosk.hidden && now - lastActive > 3500 && !(drag && drag.moved);
  if (idle !== uiIdle) { uiIdle = idle; document.body.classList.toggle('ui-idle', idle); }
  if (!needDraw) return;
  needDraw = false; lastGlow = now; drawn++;
  hall.setHouse(house);
  if (realCols) hall.setScreenLight(realCols, glow); else hall.updateGlow(t, glow);
  renderer.render(scene, cam);
  if (poseDirty) { poseDirty = false; sendPose(); }
  cssRenderer.render(cssScene, cam);
}
let lastSig = NaN, lastHover = -2, lastGlow = 0, drawn = 0;
document.addEventListener('visibilitychange', () => { needDraw = true; });

/* ---------------- boot ---------------- */
renderRecent();
const urlVid = parseYouTube(new URLSearchParams(location.search).get('v') || '');
startAt = Math.max(0, parseInt(new URLSearchParams(location.search).get('t') || '0', 10) || 0);
if (urlVid) { addRecent(urlVid); history.replaceState(null, '', location.pathname); }
const startVid = recent[0] ? { id: recent[0].id, list: recent[0].list } : DEFAULT_VIDEO;
current = startVid;
if (!recent.length) addRecent(DEFAULT_VIDEO);
const savedSeat = store.get('seat', null);
if (savedSeat && savedSeat.i >= 0 && savedSeat.i < ROWS && savedSeat.j >= 0 && savedSeat.j < COLS) {
  selectSeat(savedSeat.i, savedSeat.j, { instant: true, quiet: true });
  kiosk.hidden = true;
  showHint();
} else {
  bSeat.textContent = 'Choose seat';
  kiosk.dataset.mode = 'lobby';
  kiosk.hidden = false;
}
applyAudience();
applyHall();
initPlayer();
loadTint(startVid.id);
requestAnimationFrame(frame);

// small read-only handle used by the verification script
window.cinema = {
  get seat() { return seat; },
  get mode() { return mode; },
  get lights() { return { state: lightsState, house }; },
  get playerState() { return pState; },
  get camera() { return { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: cam.rotation.y, pitch: cam.rotation.x, fov: cam.fov }; },
  get flying() { return !!fly; },
  get drawn() { return drawn; },
  get lastError() { return lastError; },
  get volume() { return ready ? player.getVolume() : null; },
};
