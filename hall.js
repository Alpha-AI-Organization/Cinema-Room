import * as THREE from 'three';

export const ROWS = 8;
export const COLS = 12;
export const SCREEN = { w: 8, h: 4.5, cy: 2.8 };
const PX = 0.6;        // seat pitch
const AISLE = 0.34;    // extra half-gap at the centre aisle
const RP = 1.2;        // row pitch
const Z0 = 7.2;        // z of row A
const W = 5.4;         // half hall width
const HH = 8;          // wall height
const BACK = 17.2;     // back wall z

export const rowY = (i) => 0.3 + 0.38 * i;
export const rowZ = (i) => Z0 + RP * i;
export const seatX = (j) => (j - 5.5) * PX + (j < 6 ? -AISLE : AISLE);
export const eyeFor = (i, j) => new THREE.Vector3(seatX(j), rowY(i) + 1.2, rowZ(i) + 0.08);
export const seatLabel = (i, j) => `Row ${String.fromCharCode(65 + i)}, seat ${j + 1}`;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, s, n, rnd, light, dark, size = 2) {
  for (let k = 0; k < n; k++) {
    const x = rnd() * s, y = rnd() * s, a = rnd() * 0.2;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(${light},${a})` : `rgba(${dark},${a * 1.4})`;
    ctx.fillRect(x, y, size, size);
  }
}

function scaleUV(geo, u, v) {
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * u, uv.getY(k) * v);
  return geo;
}

export function buildHall(scene) {
  const rnd = mulberry32(11);
  const dummy = new THREE.Object3D();
  scene.fog = new THREE.FogExp2(0x140c09, 0.02);

  // ---------- textures ----------
  const carpetTex = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#3a1a19'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, rnd, '255,210,180', '0,0,0');
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
    for (let k = -s; k <= s * 2; k += 64) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k, s); ctx.lineTo(k + s, 0); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,190,140,0.07)';
    for (let k = -s; k <= s * 2; k += 64) {
      ctx.beginPath(); ctx.moveTo(k + 4, 0); ctx.lineTo(k + s + 4, s); ctx.stroke();
    }
  });
  const fabricTex = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let k = 0; k < s; k += 3) {
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(s, k); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, s); ctx.stroke();
    }
    speckle(ctx, s, 3000, rnd, '255,255,255', '0,0,0', 1);
  });
  const plasterTex = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#4a3c35'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 3000, rnd, '255,230,200', '0,0,0', 1);
  });
  const curtainTex = canvasTex(256, (ctx, s) => {
    for (let x = 0; x < s; x++) {
      const v = 0.55 + 0.45 * Math.sin((x / s) * Math.PI * 2 * 8);
      const g = Math.round(90 + v * 130);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x, 0, 1, s);
    }
    speckle(ctx, s, 2500, rnd, '255,255,255', '0,0,0', 1);
  });
  const glowTex = canvasTex(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,196,120,0.95)');
    g.addColorStop(0.35, 'rgba(255,160,80,0.35)');
    g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }, [1, 1], true);

  // ---------- materials ----------
  const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1, color: 0xffffff });
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95, color: 0xffffff });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x070504, roughness: 1 });
  const panelMat = new THREE.MeshStandardMaterial({ map: fabricTex, color: 0x4a3128, roughness: 1 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 1 });
  const curtainMat = new THREE.MeshStandardMaterial({
    map: curtainTex, color: 0x7d141c, roughness: 0.8, side: THREE.DoubleSide,
  });
  const seatMat = new THREE.MeshStandardMaterial({ map: fabricTex, color: 0xffffff, roughness: 0.92 });
  const seatBaseMat = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.8 });

  const root = new THREE.Group();
  scene.add(root);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    root.add(m);
    return m;
  };

  // ---------- room shell ----------
  // front floor
  add(scaleUV(new THREE.PlaneGeometry(2 * W, Z0 - 0.6, 1, 1), 2 * W / 1.6, (Z0 - 0.6) / 1.6),
    carpetMat, 0, 0, (Z0 - 0.6) / 2, -Math.PI / 2);
  // rows (stepped tops)
  for (let i = 0; i < ROWS; i++) {
    const depth = RP + (i === ROWS - 1 ? BACK - (rowZ(i) + RP / 2) : 0);
    const zc = rowZ(i) - RP / 2 + depth / 2;
    add(scaleUV(new THREE.PlaneGeometry(2 * W, depth), 2 * W / 1.6, depth / 1.6), carpetMat,
      0, rowY(i), zc, -Math.PI / 2);
  }
  // risers (faces toward the screen, visible from the front only, cheap and closes the steps)
  for (let i = 0; i < ROWS; i++) {
    const h = i === 0 ? rowY(0) : 0.38;
    add(new THREE.PlaneGeometry(2 * W, h), darkMat, 0, rowY(i) - h / 2, rowZ(i) - RP / 2, 0, Math.PI);
  }
  // stage
  add(new THREE.BoxGeometry(2 * W - 1.8, 0.25, 1.4), darkMat, 0, 0.125, 0.7);
  // walls
  add(scaleUV(new THREE.PlaneGeometry(BACK, HH), BACK / 2.5, HH / 2.5), wallMat, -W, HH / 2, BACK / 2, 0, Math.PI / 2);
  add(scaleUV(new THREE.PlaneGeometry(BACK, HH), BACK / 2.5, HH / 2.5), wallMat, W, HH / 2, BACK / 2, 0, -Math.PI / 2);
  add(scaleUV(new THREE.PlaneGeometry(2 * W, HH), 2 * W / 2.5, HH / 2.5), wallMat, 0, HH / 2, BACK, 0, Math.PI);
  add(new THREE.PlaneGeometry(2 * W, HH), new THREE.MeshStandardMaterial({ color: 0x120d0b, roughness: 1 }),
    0, HH / 2, -0.1);
  add(new THREE.PlaneGeometry(2 * W, BACK + 0.2), ceilMat, 0, HH, BACK / 2, Math.PI / 2);

  // ---------- screen: black masking border and the "hole" ----------
  const sw = SCREEN.w, sh = SCREEN.h, cy = SCREEN.cy, bt = 0.45;
  const frameGeo = (w, h) => new THREE.BoxGeometry(w, h, 0.12);
  add(frameGeo(sw + 2 * bt, bt), darkMat, 0, cy + sh / 2 + bt / 2, 0.02);
  add(frameGeo(sw + 2 * bt, bt), darkMat, 0, cy - sh / 2 - bt / 2, 0.02);
  add(frameGeo(bt, sh), darkMat, -sw / 2 - bt / 2, cy, 0.02);
  add(frameGeo(bt, sh), darkMat, sw / 2 + bt / 2, cy, 0.02);
  const holeMat = new THREE.MeshBasicMaterial({
    color: 0x000000, opacity: 0, transparent: true, blending: THREE.NoBlending,
    fog: false, toneMapped: false,
  });
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), holeMat);
  hole.position.set(0, cy, 0.0);
  hole.renderOrder = 5;
  root.add(hole);

  // curtains: pleated sheets either side of the screen frame
  const curtainW = W - (sw / 2 + bt) - 0.02;
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(curtainW, HH, 40, 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      pos.setZ(k, 0.16 + Math.sin(pos.getX(k) * 17) * 0.07);
    }
    g.computeVertexNormals();
    scaleUV(g, 1, 1);
    add(g, curtainMat, side * (sw / 2 + bt + curtainW / 2), HH / 2, 0.04);
  }
  // valance above the screen
  {
    const g = new THREE.PlaneGeometry(2 * W, HH - (cy + sh / 2 + bt) , 80, 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setZ(k, 0.1 + Math.sin(pos.getX(k) * 15) * 0.06);
    g.computeVertexNormals();
    add(g, curtainMat, 0, (HH + cy + sh / 2 + bt) / 2, 0.04);
  }

  // ---------- acoustic panels ----------
  const panelN = 9;
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), panelMat, panelN * 2);
  {
    let k = 0;
    for (const side of [-1, 1]) {
      for (let n = 0; n < panelN; n++) {
        dummy.position.set(side * (W - 0.06), 4.2, 1.4 + n * 1.9);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.12, 3.8, 1.05);
        dummy.updateMatrix();
        panels.setMatrixAt(k, dummy.matrix);
        const v = 0.85 + rnd() * 0.3;
        panels.setColorAt(k, new THREE.Color(v, v * 0.95, v * 0.9));
        k++;
      }
    }
  }
  root.add(panels);
  // wood trim above and below the panel band
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.7 });
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, 0.14, BACK - 0.4), trimMat, side * (W - 0.07), 6.2, BACK / 2 + 0.2);
    add(new THREE.BoxGeometry(0.16, 0.14, BACK - 0.4), trimMat, side * (W - 0.07), 2.2, BACK / 2 + 0.2);
  }

  // ---------- wall sconces (lamp + soft halo on the wall) ----------
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb56a, fog: false });
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    opacity: 1,
  });
  const lampGeo = new THREE.BoxGeometry(0.1, 0.5, 0.16);
  const haloGeo = new THREE.PlaneGeometry(3.4, 4.2);
  for (const side of [-1, 1]) {
    for (const z of [2.35, 6.15, 9.95, 13.75]) {
      add(lampGeo, lampMat, side * (W - 0.1), 3.8, z);
      add(haloGeo, haloMat, side * (W - 0.15), 3.9, z, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  // ---------- ceiling downlights ----------
  const downMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8, fog: false });
  const downs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 16), downMat, 12);
  {
    let k = 0;
    for (const x of [-3, 0, 3]) for (const z of [4, 8, 12, 16]) {
      dummy.position.set(x, HH - 0.02, z); dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      downs.setMatrixAt(k++, dummy.matrix);
    }
  }
  root.add(downs);

  // ---------- step lights and exit signs ----------
  const stepMat = new THREE.MeshBasicMaterial({ color: 0xffa24a, fog: false });
  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stepMat, ROWS * 3);
  {
    let k = 0;
    for (let i = 0; i < ROWS; i++) for (const x of [-4.65, 0, 4.65]) {
      dummy.position.set(x, rowY(i) + 0.015, rowZ(i) - RP / 2 + 0.05);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(x === 0 ? 0.6 : 0.9, 0.03, 0.05);
      dummy.updateMatrix();
      steps.setMatrixAt(k++, dummy.matrix);
    }
  }
  root.add(steps);
  const exitMat = new THREE.MeshBasicMaterial({ color: 0x2fe07a, fog: false });
  for (const x of [-4.6, 4.6]) add(new THREE.BoxGeometry(0.6, 0.22, 0.05), exitMat, x, 4.6 + 0.3, BACK - 0.03);
  // projection booth windows
  const boothMat = new THREE.MeshBasicMaterial({ color: 0x57647a, fog: false });
  for (const x of [-1.2, 0, 1.2]) add(new THREE.BoxGeometry(0.5, 0.3, 0.05), boothMat, x, 6.8, BACK - 0.03);

  // ---------- seats ----------
  const N = ROWS * COLS;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cushion = new THREE.InstancedMesh(unit, seatMat, N);
  const back = new THREE.InstancedMesh(unit, seatMat, N);
  const arms = new THREE.InstancedMesh(unit, seatMat, N * 2);
  const bases = new THREE.InstancedMesh(unit, seatBaseMat, N);
  const place = (mesh, k, x, y, z, sx, sy, sz, rx = 0) => {
    dummy.position.set(x, y, z); dummy.rotation.set(rx, 0, 0); dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix);
  };
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const k = i * COLS + j, x = seatX(j), y = rowY(i), z = rowZ(i);
    place(cushion, k, x, y + 0.46, z - 0.02, 0.5, 0.14, 0.54, -0.04);
    place(back, k, x, y + 0.84, z + 0.28, 0.5, 0.68, 0.12, 0.14);
    place(arms, k * 2, x - 0.285, y + 0.66, z + 0.02, 0.07, 0.09, 0.52);
    place(arms, k * 2 + 1, x + 0.285, y + 0.66, z + 0.02, 0.07, 0.09, 0.52);
    place(bases, k, x, y + 0.21, z + 0.04, 0.3, 0.42, 0.34);
  }
  const baseCol = new THREE.Color(0x8c2230);
  const mineCol = new THREE.Color(0xd8923a);
  const hoverCol = new THREE.Color(0xb94d3a);
  const seatCols = [];
  for (let k = 0; k < N; k++) {
    const v = 0.88 + rnd() * 0.2;
    const c = baseCol.clone().multiplyScalar(v);
    seatCols.push(c);
    cushion.setColorAt(k, c); back.setColorAt(k, c);
  }
  for (let k = 0; k < N * 2; k++) arms.setColorAt(k, new THREE.Color(0x4a1a1e));
  [cushion, back, arms, bases].forEach((m) => root.add(m));

  let selected = -1, hovered = -1;
  const paint = (k) => {
    const c = k === selected ? mineCol : k === hovered ? hoverCol : seatCols[k];
    cushion.setColorAt(k, c); back.setColorAt(k, c);
  };
  const flush = () => { cushion.instanceColor.needsUpdate = true; back.instanceColor.needsUpdate = true; };

  // ---------- audience silhouettes ----------
  const headGeo = new THREE.SphereGeometry(0.115, 14, 10);
  const bodyGeo = new THREE.BoxGeometry(0.4, 0.34, 0.2);
  const silMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1 });
  const heads = new THREE.InstancedMesh(headGeo, silMat, N);
  const bodies = new THREE.InstancedMesh(bodyGeo, silMat, N);
  heads.count = bodies.count = 0;
  heads.frustumCulled = bodies.frustumCulled = false;
  root.add(heads, bodies);
  const occupied = (() => {
    const r = mulberry32(99);
    return Array.from({ length: N }, (_, k) => r() < 0.4 && Math.floor(k / COLS) >= 0);
  })();
  function setAudience(on, skip = -1) {
    if (!on) { heads.count = bodies.count = 0; return; }
    let n = 0;
    const r = mulberry32(5);
    for (let k = 0; k < N; k++) {
      const jitter = [r() - 0.5, r() - 0.5, r()];
      if (!occupied[k] || k === skip) continue;
      const i = Math.floor(k / COLS), j = k % COLS, x = seatX(j), y = rowY(i), z = rowZ(i);
      dummy.rotation.set(0, jitter[0] * 0.6, jitter[1] * 0.12);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(x + jitter[0] * 0.06, y + 1.16 + jitter[2] * 0.06, z + 0.1);
      dummy.updateMatrix(); heads.setMatrixAt(n, dummy.matrix);
      dummy.position.set(x, y + 0.9, z + 0.13);
      dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); bodies.setMatrixAt(n, dummy.matrix);
      n++;
    }
    heads.count = bodies.count = n;
    heads.instanceMatrix.needsUpdate = bodies.instanceMatrix.needsUpdate = true;
  }

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xffe0bd, 0x2a1410, 3);
  scene.add(hemi);
  const downLights = [6, 12.5].map((z) => {
    const l = new THREE.PointLight(0xffd2a0, 40, 0, 2);
    l.position.set(0, 7.3, z); scene.add(l); return l;
  });
  const screenLights = [[-2.6, 2.8, 2.2], [2.6, 2.8, 2.2], [0, 6.4, 3.2]].map((p) => {
    const l = new THREE.PointLight(0x9fc0ff, 0, 0, 2);
    l.position.set(...p); scene.add(l); return l;
  });

  const lampOn = new THREE.Color(0xffb56a), lampOff = new THREE.Color(0x6a3c1c);
  const downOn = new THREE.Color(0xffd9a8), downOff = new THREE.Color(0x1e1610);

  let house = 1;
  function setHouse(h) {
    house = h;
    hemi.intensity = 1.2 + 2.2 * h;
    for (const l of downLights) l.intensity = 40 * h;
    haloMat.opacity = 0.3 + 0.7 * h;
    lampMat.color.copy(lampOff).lerp(lampOn, 0.25 + 0.75 * h);
    downMat.color.copy(downOff).lerp(downOn, h);
    scene.fog.color.setRGB(0.08 * (0.5 + h), 0.05 * (0.5 + h), 0.04 * (0.5 + h));
  }
  setHouse(1);

  const cool = new THREE.Color(0x86aaff), warm = new THREE.Color(0xffb57a), tmp = new THREE.Color();
  function updateGlow(t, level) {
    const mix = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
    tmp.copy(cool).lerp(warm, mix);
    const flick = 0.82 + 0.18 * Math.sin(t * 1.7) * Math.sin(t * 0.63 + 2) + 0.06 * Math.sin(t * 4.1);
    for (let n = 0; n < screenLights.length; n++) {
      screenLights[n].color.copy(tmp);
      screenLights[n].intensity = level * flick * (n === 2 ? 20 : 60);
    }
  }

  return {
    hole, cushion, back,
    setHouse, updateGlow, setAudience,
    get house() { return house; },
    setSelected(k) { const p = selected; selected = k; if (p >= 0) paint(p); if (k >= 0) paint(k); flush(); },
    setHover(k) { if (k === hovered) return; const p = hovered; hovered = k; if (p >= 0) paint(p); if (k >= 0) paint(k); flush(); },
  };
}
