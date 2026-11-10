// Sound booth: captures the Cinema Room tab (picture + sound, with the user's permission),
// plays the sound back as 3D audio from the screen position, and sends the real screen
// colours back to the hall so the room light follows the film. Nothing leaves the browser.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var chan = new BroadcastChannel('cinema-room');
  var statusEl = $('#status');
  var stream = null, ctx = null, nodes = null, timer = 0;
  var on3d = true, realLight = true;
  var pose = null; // last camera pose and screen rectangle from the cinema tab
  var video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  var cv = document.createElement('canvas'); cv.width = 6; cv.height = 4;
  var c2 = cv.getContext('2d', { willReadFrequently: true });

  function say(text, bad) { statusEl.textContent = text; statusEl.classList.toggle('bad', !!bad); }

  chan.onmessage = function (e) {
    var m = e.data || {};
    if (m.type === 'pose') { pose = m; applyListener(); }
  };

  function impulse(ac, seconds) {
    var n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return buf;
  }

  function speaker(ac, x, y, z) {
    var p = ac.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 9; p.rolloffFactor = 0.7; p.maxDistance = 60;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    return p;
  }

  function buildAudio() {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    var src = ctx.createMediaStreamSource(stream);
    var split = ctx.createChannelSplitter(2);
    var master = ctx.createGain();
    var dry3d = ctx.createGain(), plain = ctx.createGain(), wet = ctx.createGain();
    var left = speaker(ctx, -6.4, 4.75, 0.3), right = speaker(ctx, 6.4, 4.75, 0.3);
    var conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 1.3);
    src.connect(split);
    split.connect(left, 0); split.connect(right, 1);
    left.connect(dry3d); right.connect(dry3d);
    src.connect(conv); conv.connect(wet);
    src.connect(plain);
    dry3d.connect(master); wet.connect(master); plain.connect(master);
    master.connect(ctx.destination);
    nodes = { master: master, dry3d: dry3d, plain: plain, wet: wet };
    applyMix(); applyListener();
  }

  function applyMix() {
    if (!nodes) return;
    var t = ctx.currentTime;
    nodes.master.gain.setTargetAtTime(+$('#vol').value / 100, t, 0.05);
    nodes.dry3d.gain.setTargetAtTime(on3d ? 1.25 : 0, t, 0.05);
    nodes.wet.gain.setTargetAtTime(on3d ? (+$('#room').value / 100) * 0.5 : 0, t, 0.05);
    nodes.plain.gain.setTargetAtTime(on3d ? 0 : 1, t, 0.05);
  }

  function applyListener() {
    if (!ctx || !pose) return;
    var l = ctx.listener, t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pose.pos[0], t, 0.05); l.positionY.setTargetAtTime(pose.pos[1], t, 0.05); l.positionZ.setTargetAtTime(pose.pos[2], t, 0.05);
      l.forwardX.setTargetAtTime(pose.dir[0], t, 0.05); l.forwardY.setTargetAtTime(pose.dir[1], t, 0.05); l.forwardZ.setTargetAtTime(pose.dir[2], t, 0.05);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pose.pos[0], pose.pos[1], pose.pos[2]);
      l.setOrientation(pose.dir[0], pose.dir[1], pose.dir[2], 0, 1, 0);
    }
  }

  // average colour of the left, middle and right third of the film picture
  function sample() {
    if (!realLight || !pose || !pose.rect || !video.videoWidth) return;
    var r = pose.rect, W = video.videoWidth, H = video.videoHeight;
    var x0 = r[0], y0 = r[1], x1 = r[2], y1 = r[3];
    var w = x1 - x0, h = y1 - y0;
    if (w < 0.05 || h < 0.05) return;
    // stay inside the picture, and skip the lowest part where seat backs can cover it
    var sx = (x0 + w * 0.06) * W, sy = (y0 + h * 0.08) * H, sw = w * 0.88 * W, sh = h * 0.62 * H;
    try { c2.drawImage(video, sx, sy, sw, sh, 0, 0, 6, 4); } catch (err) { return; }
    var d = c2.getImageData(0, 0, 6, 4).data, cols = [];
    for (var z = 0; z < 3; z++) {
      var R = 0, G = 0, B = 0;
      for (var y = 0; y < 4; y++) for (var x = z * 2; x < z * 2 + 2; x++) { var i = (y * 6 + x) * 4; R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      cols.push([R / 8 / 255, G / 8 / 255, B / 8 / 255]);
    }
    chan.postMessage({ type: 'cols', cols: cols });
  }

  function stop(msg) {
    clearInterval(timer); timer = 0;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (ctx) ctx.close();
    ctx = null; nodes = null;
    video.srcObject = null;
    chan.postMessage({ type: 'bye' });
    $('#live').hidden = true; $('#intro').hidden = false;
    say(msg || 'Disconnected. The cinema plays its normal sound again.');
  }

  async function connect() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { say('This browser cannot share a tab. Use Chrome or Edge on a computer.', true); return; }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 8, width: { max: 640 } },
        audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'exclude',
      });
    } catch (err) { say('Nothing was shared. Press Connect to try again.', true); return; }
    var a = stream.getAudioTracks()[0], v = stream.getVideoTracks()[0];
    if (v) { v.addEventListener('ended', function () { stop(); }); video.srcObject = stream; video.play().catch(function () {}); }
    $('#intro').hidden = true; $('#live').hidden = false;
    var notes = [];
    if (a) {
      buildAudio();
      var st = a.getSettings ? a.getSettings() : {};
      if (st.suppressLocalAudioPlayback !== true) notes.push('This browser did not silence the cinema tab, so you may hear the sound twice. A recent Chrome or Edge is needed for this.');
    } else notes.push('No sound was shared, so there is no 3D sound. Disconnect, connect again and turn on "Also share tab audio".');
    timer = setInterval(sample, 160);
    chan.postMessage({ type: 'hello' });
    say(notes.length ? notes.join(' ') : 'Connected. 3D sound is on and the hall light follows the film.', notes.length > 0);
  }

  $('#connect').addEventListener('click', connect);
  $('#stop').addEventListener('click', function () { stop(); });
  $('#vol').addEventListener('input', applyMix);
  $('#room').addEventListener('input', applyMix);
  $('#s3d').addEventListener('click', function () {
    on3d = !on3d; this.setAttribute('aria-pressed', String(on3d)); this.textContent = on3d ? 'On' : 'Off'; applyMix();
  });
  $('#lightb').addEventListener('click', function () {
    realLight = !realLight; this.setAttribute('aria-pressed', String(realLight)); this.textContent = realLight ? 'Real picture' : 'Simple glow';
    if (!realLight) chan.postMessage({ type: 'nocols' });
  });
  addEventListener('pagehide', function () { if (stream) stop(); });
})();
