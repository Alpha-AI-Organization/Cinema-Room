import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/CSS3DRenderer.js';
import { buildHall, ROWS, COLS, SCREEN, eyeFor, seatLabel } from './hall.js?v=12';
import { parseYouTube } from './parse.js?v=12';

// cinema.localhost is the one address where everything works: YouTube accepts it for music videos
// (it refuses bare 127.0.0.1) and the browser treats it as secure, which tab sharing needs.
if (location.hostname === 'cinema.localtest.me') location.replace('http://cinema.localhost:' + location.port + '/' + location.search);

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
const hall = buildHall(scene, () => { needDraw = true; });

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
// 'seat': the view from the chosen seat. 'centre': straight in front of the screen, any seat.
// 'flat': only the screen, filling the window; the 3D hall is not drawn at all (slow computers).
let viewMode = store.get('viewMode', 'seat');
const fitDist = (margin) => {
  const th = Math.tan((cam.fov * Math.PI) / 360);
  return Math.max(SCREEN.h / 2 / th, SCREEN.w / 2 / (th * cam.aspect)) * margin;
};
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
  if (viewMode === 'flat') { cam.position.set(0, SCREEN.cy, fitDist(1)); cam.rotation.set(0, 0, 0, 'YXZ'); }
  else if (viewMode === 'centre' && typeof mode !== 'undefined' && mode === 'seated' && !fly) {
    cam.position.set(0, SCREEN.cy, fitDist(1.12)); cam.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  }
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
  setTimeout(() => { if (party.role) { partySeat(); partyUi(); } }, 0);
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
  if (wasLobby && !quiet && party.role !== 'guest') startPlayback(); // a guest waits for the host
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
let partyReady = false; // set once the watch together panel exists
let sharingNow = false;
/* ---------------- a direct video file link on the screen ---------------- */
let file = null; // { url, video }
function stopFile() {
  if (!file) return;
  file.video.pause(); file.video.removeAttribute('src'); file.video.load(); file.video.remove();
  file = null; lightsState = 'idle'; needDraw = true;
}
function startFile(url, autoplay) {
  if (share.stream && !share.remote) stopShare();
  stopFile();
  try { if (ready) player.pauseVideo(); } catch { /* no player */ }
  const v = document.createElement('video');
  v.className = 'shared file'; v.controls = true; v.playsInline = true; v.preload = 'auto';
  v.src = url; v.volume = clamp(userVol / 100, 0, 1);
  ytWrap.appendChild(v);
  file = { url, video: v };
  const tell = () => { if (party.role === 'host') partySendState(); };
  v.addEventListener('play', () => { lightsState = 'play'; lastActive = performance.now(); needDraw = true; tell(); });
  v.addEventListener('pause', () => { lightsState = v.ended ? 'end' : 'pause'; needDraw = true; tell(); });
  v.addEventListener('seeked', tell);
  v.addEventListener('error', () => { if (file && file.video === v) setNotice('This link did not play. It must be a direct link to a video file (for example .mp4 or .webm) that is allowed to play on other pages.'); });
  setNotice('');
  if (autoplay) v.play().catch(() => {});
  if (party.role === 'host') partySendState();
} // true while a tab or window is shown on the screen
let ytDirect = store.get('ytDirect', true); // by default the mouse works the YouTube player on the screen
function applyYt() {
  bYt.setAttribute('aria-pressed', String(ytDirect));
  bYt.textContent = ytDirect ? 'Mouse on screen: YouTube' : 'Mouse on screen: look around';
  document.body.classList.toggle('yt-direct', ytDirect && !sharingNow);
}
applyYt();
bYt.addEventListener('click', () => { ytDirect = !ytDirect; store.set('ytDirect', ytDirect); applyYt(); });

/* ---------------- any tab or window on the screen ---------------- */
// The browser lets the user share a tab, a window or the whole display. The picture goes on the
// cinema screen. Because the page owns that picture and sound, the hall light follows the real
// picture and the sound is real 3D audio coming from the screen. Nothing is recorded or sent.
const bReal = $('#btn-real'), b3d = $('#btn-3d');
let realCols = null, realAt = 0, poseDirty = true;
const share = { stream: null, video: null, ctx: null, nodes: null, timer: 0, remote: false, calls: [], on3d: store.get('share3d', true) };
const sCv = document.createElement('canvas'); sCv.width = 6; sCv.height = 4;
const sCtx = sCv.getContext('2d', { willReadFrequently: true });
const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
bReal.hidden = !canShare;

function shareUi() {
  const on = !!share.stream;
  sharingNow = on;
  bReal.setAttribute('aria-pressed', String(on));
  bReal.textContent = on ? (share.remote ? 'The host is showing a screen' : 'Stop showing') : 'Show a tab or window';
  bReal.disabled = on && share.remote;
  b3d.setAttribute('aria-pressed', String(share.on3d));
  b3d.textContent = '3D sound: ' + (share.on3d ? 'on' : 'off');
  document.body.classList.toggle('sharing', on);
  if (partyReady) partyUi();
  document.body.classList.toggle('yt-direct', ytDirect && !on);
}
function sampleShare() {
  const v = share.video; if (!v || !v.videoWidth || viewMode === 'flat') return;
  try { sCtx.drawImage(v, 0, 0, 6, 4); } catch { return; }
  const d = sCtx.getImageData(0, 0, 6, 4).data, cols = [];
  for (let z = 0; z < 3; z++) {
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < 4; y++) for (let x = z * 2; x < z * 2 + 2; x++) { const k = (y * 6 + x) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; }
    cols.push([r / 2040, g / 2040, b / 2040]);
  }
  realCols = cols; realAt = performance.now(); needDraw = true;
}
function impulse(ac, seconds) {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 2.6); }
  return buf;
}
function speaker(ac, x) {
  const p = ac.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 9; p.rolloffFactor = 0.7; p.maxDistance = 60;
  p.positionX.value = x; p.positionY.value = SCREEN.cy; p.positionZ.value = 0.3;
  return p;
}
function buildShareAudio() {
  const ac = new AudioContext({ latencyHint: 'interactive' });
  const src = ac.createMediaStreamSource(share.stream);
  const split = ac.createChannelSplitter(2), master = ac.createGain();
  const dry = ac.createGain(), plain = ac.createGain(), wet = ac.createGain();
  const left = speaker(ac, -SCREEN.w * 0.45), right = speaker(ac, SCREEN.w * 0.45);
  const conv = ac.createConvolver(); conv.buffer = impulse(ac, 1.3);
  src.connect(split); split.connect(left, 0); split.connect(right, 1);
  left.connect(dry); right.connect(dry);
  src.connect(conv); conv.connect(wet); src.connect(plain);
  dry.connect(master); wet.connect(master); plain.connect(master); master.connect(ac.destination);
  if (ac.state === 'suspended') { const wake = () => { ac.resume(); removeEventListener('pointerdown', wake, true); }; addEventListener('pointerdown', wake, true); }
  share.ctx = ac; share.nodes = { master, dry, plain, wet };
  shareMix(); poseDirty = true;
}
function shareMix() {
  if (!share.nodes) return;
  const t = share.ctx.currentTime, n = share.nodes;
  n.master.gain.setTargetAtTime(+volEl.value / 100, t, 0.05);
  n.dry.gain.setTargetAtTime(share.on3d ? 1.25 : 0, t, 0.05);
  n.wet.gain.setTargetAtTime(share.on3d ? 0.16 : 0, t, 0.05);
  n.plain.gain.setTargetAtTime(share.on3d ? 0 : 1, t, 0.05);
}
const fwd = new THREE.Vector3();
function sendPose() { // the 3D sound listener sits where the viewer sits and looks where they look
  if (!share.ctx) return;
  const l = share.ctx.listener, t = share.ctx.currentTime;
  cam.getWorldDirection(fwd);
  if (l.positionX) {
    l.positionX.setTargetAtTime(cam.position.x, t, 0.05); l.positionY.setTargetAtTime(cam.position.y, t, 0.05); l.positionZ.setTargetAtTime(cam.position.z, t, 0.05);
    l.forwardX.setTargetAtTime(fwd.x, t, 0.05); l.forwardY.setTargetAtTime(fwd.y, t, 0.05); l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else { l.setPosition(cam.position.x, cam.position.y, cam.position.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
}
function stopShare() {
  if (!share.stream) return;
  clearInterval(share.timer);
  if (!share.remote) {
    share.stream.getTracks().forEach((t) => t.stop());
    for (const c of share.calls) { try { c.close(); } catch { /* gone */ } }
    share.calls = [];
  }
  share.remote = false;
  if (share.ctx) share.ctx.close();
  share.video.srcObject = null; share.video.remove();
  share.stream = share.video = share.ctx = share.nodes = null;
  realCols = null; lightsState = 'pause'; needDraw = true;
  setNotice(''); shareUi();
  if (party.role === 'host') partySendState();
}
async function startShare() {
  if (share.stream) { stopShare(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include',
    });
  } catch { return; }
  await mountShare(stream, false);
  if (party.role === 'host') { for (const c of party.conns) partyCall(c.peer); partySendState(); }
}
async function mountShare(stream, remote) {
  if (share.stream) stopShare();
  share.remote = remote;
  if (file) file.video.pause();
  try { if (ready) player.pauseVideo(); } catch { /* no player */ }
  const v = document.createElement('video');
  v.className = 'shared';
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  ytWrap.appendChild(v);
  share.stream = stream; share.video = v;
  await v.play().catch(() => {});
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.addEventListener('ended', () => { if (share.stream === stream) stopShare(); });
  if (stream.getAudioTracks().length) buildShareAudio();
  share.timer = setInterval(sampleShare, 150);
  lightsState = 'play'; lastActive = performance.now();
  if (mode !== 'lobby') closeKiosk();
  shareUi();
  setNotice(share.ctx || remote ? '' : 'No sound was shared, so the sound still comes from the other tab. To get 3D sound: stop, share a browser tab again and turn on "Also share tab audio".');
}
bReal.addEventListener('click', startShare);
b3d.addEventListener('click', () => {
  share.on3d = !share.on3d; store.set('share3d', share.on3d); shareMix(); shareUi();
  if (!share.ctx) setNotice('3D sound works on a shown tab: press "Show a tab or window", pick a browser tab and turn on "Also share tab audio". The browser does not let a page change the sound of the YouTube player.');
});

/* ---------------- view and curve buttons ---------------- */
const bView = $('#btn-view'), bCurve = $('#btn-curve');
const VIEW_NAMES = { seat: 'View: my seat', centre: 'View: centre', flat: 'View: screen only (light)' };
function applyView() {
  bView.textContent = VIEW_NAMES[viewMode];
  document.body.classList.toggle('flat', viewMode === 'flat');
  needDraw = true; poseDirty = true;
}
bView.addEventListener('click', () => {
  viewMode = { seat: 'centre', centre: 'flat', flat: 'seat' }[viewMode] || 'seat';
  store.set('viewMode', viewMode); applyView();
});
// Curve: an iframe cannot be bent, so the picture is warped the way a curved screen looks from
// the middle: "in" makes the sides taller than the middle, "out" the other way round.
let curve = store.get('curve', 'off');
{
  const K = 0.09, maxOff = 360 * (1 / (1 - K) - 1), SC = Math.ceil(maxOff * 2.1);
  const map = (inward) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const u = (x + 0.5) / 256, v = (y + 0.5) / 256, e = (2 * u - 1) ** 2;
      const s = inward ? 1 - K * (1 - e) : 1 - K * e;
      const off = ((v - 0.5) / s - (v - 0.5)) * 720;
      const k = (y * 256 + x) * 4;
      img.data[k] = 128; img.data[k + 1] = Math.round(127.5 + (off / SC) * 255); img.data[k + 2] = 128; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
  const f = (id, inward) => '<filter id="' + id + '" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">'
    + '<feImage href="' + map(inward) + '" preserveAspectRatio="none" result="m"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + SC + '" xChannelSelector="R" yChannelSelector="G"/></filter>';
  const holder = document.createElement('div');
  holder.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + f('curve-in', true) + f('curve-out', false) + '</svg>';
  document.body.appendChild(holder.firstChild);
}
function applyCurve() {
  bCurve.textContent = { off: 'Curve: off', in: 'Curve: in', out: 'Curve: out' }[curve];
  ytWrap.style.filter = curve === 'off' ? '' : 'url(#curve-' + curve + ')';
  needDraw = true;
}
bCurve.addEventListener('click', () => {
  curve = { off: 'in', in: 'out', out: 'off' }[curve] || 'off';
  store.set('curve', curve); applyCurve();
});
applyView(); applyCurve();

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
  stopFile();
  current = p; lastError = null; wantPlay = autoplay; loadTint(p.id);
  setNotice('');
  applyVideo(p, autoplay);
}

let startAt = 0; // seconds, from a ?t= link
let wantPlay = false; // a play request that arrived while a cue was still loading
function startPlayback() {
  if (file) { file.video.play().catch(() => {}); return; }
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
  if (party.role === 'host') partySendState();
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
          location.replace('http://cinema.localhost:' + location.port + '/?v=' + encodeURIComponent(current && current.id || ''));
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
  if (file) { if (file.video.paused) file.video.play().catch(() => {}); else file.video.pause(); return; }
  if (!ready) return;
  const S = window.YT.PlayerState;
  if (pState === S.PLAYING || pState === S.BUFFERING && lightsState === 'play') player.pauseVideo();
  else if (pState === S.ENDED) { player.seekTo(0, true); player.playVideo(); }
  else player.playVideo();
}
function seekBy(d) {
  if (file) { file.video.currentTime = Math.max(0, file.video.currentTime + d); return; }
  if (!ready) return;
  const dur = player.getDuration() || 0;
  player.seekTo(clamp(player.getCurrentTime() + d, 0, dur || 1e9), true);
}
// "Hall sound" only scales the player volume a little by row (front louder, back softer).
// The film audio comes from a cross-origin YouTube iframe, so there is no real 3D sound.
let userVol = store.get('vol', 100);
let hallSound = !!store.get('hall', false);
const seatGain = () => (hallSound && seat ? 1 - 0.4 * (seat.i / (ROWS - 1)) : 1);
function pushVol() { if (file) file.video.volume = clamp((userVol * seatGain()) / 100, 0, 1); if (ready) player.setVolume(Math.round(userVol * seatGain())); }
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
  shareMix();
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
  const link = String(raw || '').trim();
  if (!p && /^https?:\/\//i.test(link) && !/youtu\.?be/i.test(link)) { // any other link: try it as a video file
    setMsg('');
    startFile(link, mode !== 'lobby');
    if (mode !== 'lobby') closeKiosk(); else setMsg('Loaded. Pick a seat to start the film.');
    $('#video-input').value = '';
    return true;
  }
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
    case 'Escape': closeKiosk(); break;
    default:
  }
});
addEventListener('pointerdown', activity, true);
addEventListener('pointermove', activity, true); // any mouse move wakes the controls, also over the top bar
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
  if (viewMode !== 'flat') {
    hall.setHouse(house);
    if (realCols) hall.setScreenLight(realCols, glow); else hall.updateGlow(t, glow);
    renderer.render(scene, cam);
  }
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
shareUi();
loadTint(startVid.id);
requestAnimationFrame(frame);


/* ---------------- watch together ---------------- */
// One person starts a room and sends the link. Everyone plays the same YouTube video from
// YouTube itself (full quality for each person); only small control messages travel between
// the browsers (WebRTC data channel, set up through the public PeerJS service). The host
// controls the film; guests follow within a fraction of a second. Friends show up in their seats.
const PEER_PREFIX = 'cinema-room-hall-';
const party = { role: null, peer: null, conns: [], host: null, code: '', offset: 0, bestRtt: 1e9, roster: [], me: 'me', timer: 0, drift: 0 };
const pEl = { btn: $('#btn-party'), box: $('#party'), name: $('#party-name'), start: $('#party-start'), link: $('#party-link'), copy: $('#party-copy'), status: $('#party-status'), share: $('#party-share'), leave: $('#party-leave'), who: $('#party-who') };
pEl.name.value = store.get('name', '');
pEl.name.addEventListener('change', () => { store.set('name', pEl.name.value.trim().slice(0, 24)); partySeat(); });
const partyName = () => (pEl.name.value.trim().slice(0, 24) || 'Guest');
function partyStatus(text) { pEl.status.textContent = text; }
function partyUi() {
  const on = !!party.role;
  pEl.btn.setAttribute('aria-pressed', String(on));
  pEl.btn.textContent = on ? 'Together: ' + Math.max(1, party.roster.length) : 'Watch together';
  pEl.start.hidden = on; pEl.leave.hidden = !on;
  pEl.share.hidden = party.role !== 'host' || !canShare;
  pEl.share.textContent = share.stream && !share.remote ? 'Stop sharing my screen' : 'Share my screen to the room';
  pEl.link.hidden = pEl.copy.hidden = !on;
  if (on) pEl.link.value = location.origin + location.pathname + '?room=' + party.code;
  pEl.who.textContent = '';
  for (const r of party.roster) {
    const li = document.createElement('li');
    li.textContent = r.name + (r.seat ? ', ' + seatLabel(r.seat.i, r.seat.j) : ', choosing a seat') + (r.host ? ' (host)' : '');
    pEl.who.appendChild(li);
  }
  const mine = seat ? seat.i * COLS + seat.j : -1;
  hall.setFriends(party.roster.filter((r) => r.id !== party.me && r.seat).map((r) => r.seat.i * COLS + r.seat.j).filter((k) => k !== mine));
  needDraw = true;
}
function partyState() {
  const S = window.YT && window.YT.PlayerState;
  let pos = 0;
  try { pos = ready ? player.getCurrentTime() : 0; } catch { /* not ready */ }
  if (file) return { t: 'state', sharing: !!share.stream && !share.remote, f: file.url, v: null, playing: !file.video.paused, pos: file.video.currentTime, at: Date.now() };
  return { t: 'state', sharing: !!share.stream && !share.remote, v: current ? { id: current.id, list: current.list } : null, playing: !!S && (pState === S.PLAYING || pState === S.BUFFERING), pos, at: Date.now() };
}
// ask WebRTC for a high video bitrate from the first second, and for stereo film sound
function tuneSdp(sdp) {
  return sdp.split(/(?=^m=)/m).map((p) => {
    if (p.startsWith('m=video')) return p.replace(/^(a=fmtp:\d+ (?!apt=)[^\r\n]*)/gm, '$1;x-google-start-bitrate=6000;x-google-min-bitrate=2500;x-google-max-bitrate=14000');
    if (p.startsWith('m=audio')) {
      const m = p.match(/a=rtpmap:(\d+) opus/i);
      if (m) return p.replace(new RegExp('^(a=fmtp:' + m[1] + ' [^\\r\\n]*)', 'm'), '$1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000');
    }
    return p;
  }).join('');
}
function partyCall(id) {
  if (!share.stream || share.remote || !party.peer) return;
  const call = party.peer.call(id, share.stream, { sdpTransform: tuneSdp });
  if (!call) return;
  share.calls.push(call);
  const tune = () => {
    const pc = call.peerConnection; if (!pc) return;
    for (const snd of pc.getSenders()) {
      if (!snd.track || snd.track.kind !== 'video') continue;
      snd.track.contentHint = 'motion';
      const p = snd.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 14000000; p.encodings[0].networkPriority = 'high'; p.degradationPreference = 'maintain-resolution'; p.encodings[0].maxFramerate = 30;
      snd.setParameters(p).catch(() => {});
    }
  };
  setTimeout(tune, 600); setTimeout(tune, 3000);
}
function partyBroadcast(msg) { for (const c of party.conns) if (c.open) c.send(msg); }
function partySendState() { if (party.role === 'host' && party.conns.length) partyBroadcast(partyState()); }
function partyRoster() {
  if (party.role !== 'host') return;
  party.roster = [{ id: party.me, name: partyName(), seat, host: true }].concat(party.conns.filter((c) => c.open).map((c) => ({ id: c.peer, name: c.meta.name, seat: c.meta.seat })));
  partyBroadcast({ t: 'roster', list: party.roster });
  partyUi();
}
function partySeat() { // tell the room where I sit
  if (party.role === 'host') partyRoster();
  else if (party.role === 'guest' && party.host && party.host.open) party.host.send({ t: 'me', name: partyName(), seat });
}
function partyApply(st) { // guest: follow the host
  if (st.sharing) { // the host shows a live screen: the YouTube player waits
    try { if (ready && pState === window.YT.PlayerState.PLAYING) player.pauseVideo(); } catch { /* no player */ }
    partyStatus('The host is showing a live screen to the room.');
    return;
  }
  if (share.remote && share.stream) stopShare();
  if (st.f) { // the host plays a video file link: load the same link and follow
    if (!file || file.url !== st.f) startFile(st.f, false);
    if (mode === 'lobby') return;
    const fv = file.video;
    const want = st.pos + (st.playing ? (Date.now() + party.offset - st.at) / 1000 : 0);
    const off = want - fv.currentTime;
    party.drift = off;
    if (st.playing && fv.paused) fv.play().catch(() => {});
    if (!st.playing && !fv.paused) fv.pause();
    if (Math.abs(off) > 0.8) { fv.currentTime = want + (st.playing ? 0.2 : 0); fv.playbackRate = 1; }
    else if (st.playing && Math.abs(off) > 0.15) fv.playbackRate = off > 0 ? 1.1 : 0.9;
    else fv.playbackRate = 1;
    partyStatus('In the room. The host controls the film. Offset ' + off.toFixed(2) + ' s.');
    return;
  }
  if (file && party.role === 'guest') stopFile();
  if (!ready || !st.v) return;
  const S = window.YT.PlayerState;
  const same = current && current.id === st.v.id && current.list === st.v.list;
  if (!same) { addRecent(st.v); startVideo(st.v, st.playing && mode !== 'lobby'); return; }
  if (mode === 'lobby') return; // sit down first; the film waits
  const target = st.pos + (st.playing ? (Date.now() + party.offset - st.at) / 1000 : 0);
  let cur = 0;
  try { cur = player.getCurrentTime(); } catch { return; }
  const d = target - cur;
  party.drift = d;
  if (st.playing && pState !== S.PLAYING && pState !== S.BUFFERING) player.playVideo();
  if (!st.playing && (pState === S.PLAYING || pState === S.BUFFERING)) player.pauseVideo();
  if (Math.abs(d) > 0.8) { player.seekTo(target + (st.playing ? 0.2 : 0), true); player.setPlaybackRate(1); }
  else if (st.playing && Math.abs(d) > 0.15) player.setPlaybackRate(d > 0 ? 1.25 : 0.75); // catch up or wait, gently
  else player.setPlaybackRate(1);
  partyStatus('In the room with ' + Math.max(1, party.roster.length - 1) + ' other' + (party.roster.length - 1 === 1 ? '' : 's') + '. The host controls the film. Offset ' + d.toFixed(2) + ' s.');
}
function partyLeave(msg) {
  clearInterval(party.timer);
  try { if (party.peer) party.peer.destroy(); } catch { /* already gone */ }
  if (share.remote && share.stream) stopShare();
  party.role = null; party.peer = null; party.conns = []; party.host = null; party.roster = [];
  try { if (ready) player.setPlaybackRate(1); } catch { /* no player */ }
  partyStatus(msg || 'You left the room.');
  partyUi();
}
function partyCode() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let k = 0; k < 6; k++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function partyHost() {
  if (!window.Peer) { partyStatus('The connection library did not load. Check the internet connection.'); return; }
  party.code = partyCode();
  const peer = new window.Peer(PEER_PREFIX + party.code);
  party.peer = peer; party.role = 'host'; party.me = 'host';
  partyStatus('Opening the room...');
  peer.on('open', () => { partyStatus('Room is open. Send the link to your friends, then press "Share my screen to the room".'); partyRoster(); });
  peer.on('connection', (c) => {
    c.meta = { name: 'Guest', seat: null };
    c.on('open', () => { party.conns.push(c); c.send(partyState()); partyRoster(); partyCall(c.peer); });
    c.on('data', (m) => {
      if (m.t === 'ping') c.send({ t: 'pong', c: m.c, h: Date.now() });
      else if (m.t === 'me') { c.meta = { name: String(m.name || 'Guest').slice(0, 24), seat: m.seat && m.seat.i >= 0 && m.seat.i < ROWS && m.seat.j >= 0 && m.seat.j < COLS ? { i: m.seat.i | 0, j: m.seat.j | 0 } : null }; partyRoster(); }
    });
    c.on('close', () => { party.conns = party.conns.filter((x) => x !== c); partyRoster(); });
  });
  peer.on('error', (e) => partyStatus('Room problem: ' + (e.type || 'unknown') + '. Try starting the room again.'));
  party.timer = setInterval(partySendState, 1000);
  partyUi();
}
function partyJoin(code) {
  if (!window.Peer) { partyStatus('The connection library did not load. Check the internet connection.'); return; }
  party.code = code; party.role = 'guest';
  const peer = new window.Peer();
  party.peer = peer;
  partyStatus('Joining the room...');
  peer.on('call', (call) => { // the host sends a live screen
    call.answer(undefined, { sdpTransform: tuneSdp });
    call.on('stream', (remote) => { if (share.stream !== remote) mountShare(remote, true); });
    call.on('close', () => { if (share.remote && share.stream) stopShare(); });
  });
  peer.on('open', (id) => {
    party.me = id;
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    party.host = c;
    c.on('open', () => {
      partyStatus('Connected. Pick a seat. You will see what the host shares.');
      partySeat();
      let n = 0; const ping = () => { if (c.open && n++ < 6) { c.send({ t: 'ping', c: Date.now() }); setTimeout(ping, 400); } };
      ping();
    });
    c.on('data', (m) => {
      if (m.t === 'pong') { const now = Date.now(), rtt = now - m.c; if (rtt < party.bestRtt) { party.bestRtt = rtt; party.offset = m.h - (m.c + now) / 2; } }
      else if (m.t === 'state') partyApply(m);
      else if (m.t === 'roster') { party.roster = m.list || []; partyUi(); }
    });
    c.on('close', () => partyLeave('The host closed the room.'));
  });
  peer.on('error', (e) => { partyLeave(e.type === 'peer-unavailable' ? 'This room does not exist any more. Ask for a new link.' : 'Could not join: ' + (e.type || 'unknown') + '.'); });
  partyUi();
}
pEl.btn.addEventListener('click', () => { pEl.box.hidden = !pEl.box.hidden; pEl.btn.setAttribute('aria-expanded', String(!pEl.box.hidden)); });
$('#party-close').addEventListener('click', () => { pEl.box.hidden = true; });
pEl.start.addEventListener('click', partyHost);
pEl.share.addEventListener('click', () => { startShare(); });
pEl.leave.addEventListener('click', () => partyLeave());
pEl.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pEl.link.value); pEl.copy.textContent = 'Copied'; } catch { pEl.link.select(); pEl.copy.textContent = 'Press Ctrl+C'; }
  setTimeout(() => { pEl.copy.textContent = 'Copy link'; }, 1600);
});
partyReady = true;
partyUi();
{
  const room = (new URLSearchParams(location.search).get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (room) { pEl.box.hidden = false; partyJoin(room); }
}

// small read-only handle used by the verification script
window.cinema = {
  get seat() { return seat; },
  get mode() { return mode; },
  get lights() { return { state: lightsState, house }; },
  get playerState() { return pState; },
  get camera() { return { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: cam.rotation.y, pitch: cam.rotation.x, fov: cam.fov }; },
  get flying() { return !!fly; },
  get drawn() { return drawn; },
  get sharing() { return { on: !!share.stream, remote: share.remote, w: share.video ? share.video.videoWidth : 0, sound: !!share.ctx }; },
  get file() { return file ? { url: file.url, t: file.video.currentTime, paused: file.video.paused, w: file.video.videoWidth } : null; },
  get view() { return { mode: viewMode, curve }; },
  get party() { return { role: party.role, code: party.code, people: party.roster.length, drift: party.drift, offset: party.offset }; },
  get lastError() { return lastError; },
  get volume() { return ready ? player.getVolume() : null; },
};
