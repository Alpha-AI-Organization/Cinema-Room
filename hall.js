import * as THREE from 'three';

export const ROWS = 8;
export const COLS = 12;
export const SCREEN = { w: 14.4, h: 8.1, cy: 4.75 };
const PX = 0.6;        // seat pitch
const AISLE = 0.34;    // extra half-gap at the centre aisle
const RP = 1.2;        // row pitch
const Z0 = 6.4;        // z of row A
const W = 8.2;         // half hall width
const HH = 10.6;       // wall height
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

// a box with rounded edges, built at its real size (so instances need no stretching)
function roundedBox(w, h, d, rTop, rBottom, bevel = 0.025) {
  const x = w / 2 - bevel, y = h / 2 - bevel, rt = Math.min(rTop, x, y), rb = Math.min(rBottom, x, y);
  const s = new THREE.Shape();
  s.moveTo(-x + rb, -y);
  s.lineTo(x - rb, -y); s.quadraticCurveTo(x, -y, x, -y + rb);
  s.lineTo(x, y - rt); s.quadraticCurveTo(x, y, x - rt, y);
  s.lineTo(-x + rt, y); s.quadraticCurveTo(-x, y, -x, y - rt);
  s.lineTo(-x, -y + rb); s.quadraticCurveTo(-x, -y, -x + rb, -y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.center();
  return g;
}

export function buildHall(scene, onChange = () => {}) {
  // scanned materials: colour, normal and roughness maps, 1k JPG, loaded once
  const loader = new THREE.TextureLoader();
  const texOf = (id, kind, ru, rv) => {
    const t = loader.load('assets/tex/' + id + '_' + kind + '.jpg', onChange);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 8;
    if (kind === 'col') t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const pbr = (id, ru, rv, colour = true) => {
    const o = { normalMap: texOf(id, 'nor', ru, rv), roughnessMap: texOf(id, 'rough', ru, rv), roughness: 1 };
    if (colour) o.map = texOf(id, 'col', ru, rv);
    return o;
  };

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
  const carpetMat = new THREE.MeshStandardMaterial({ ...pbr('dirty_carpet', 1.2, 1.2), color: 0x8a3a38 });
  const wallMat = new THREE.MeshStandardMaterial({ ...pbr('painted_plaster_wall', 1, 1), color: 0x7d6a5e });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x070504, roughness: 1 });
  const panelMat = new THREE.MeshStandardMaterial({ ...pbr('wool_boucle', 1, 4, false), color: 0x4a3128 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 1 });
  const curtainMat = new THREE.MeshPhysicalMaterial({
    ...pbr('velour_velvet', 3, 6, false), color: 0x7d141c, side: THREE.DoubleSide,
    sheen: 1, sheenColor: new THREE.Color(0xff5a4a), sheenRoughness: 0.45,
  });
  const seatMat = new THREE.MeshPhysicalMaterial({
    ...pbr('velour_velvet', 2.2, 2.2, false), color: 0xffffff,
    sheen: 1, sheenColor: new THREE.Color(0xff6a5a), sheenRoughness: 0.5,
  });
  const armMat = new THREE.MeshStandardMaterial({ ...pbr('dark_wood', 1, 3), color: 0x8a6a50 });
  const seatBaseMat = new THREE.MeshStandardMaterial({ ...pbr('fabric_leather_02', 1, 1, false), color: 0x15100e });

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
    new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.3, metalness: 0.15 }), 0, 0, (Z0 - 0.6) / 2, -Math.PI / 2);
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
        dummy.position.set(side * (W - 0.06), 5.2, 1.4 + n * 1.9);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.12, 5.6, 1.05);
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
  const trimMat = new THREE.MeshStandardMaterial({ ...pbr('dark_wood', 0.5, 8), color: 0x6a4a36 });
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, 0.14, BACK - 0.4), trimMat, side * (W - 0.07), 8.2, BACK / 2 + 0.2);
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
    for (const x of [-4.5, 0, 4.5]) for (const z of [4, 8, 12, 16]) {
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
  for (const x of [-W + 1, W - 1]) add(new THREE.BoxGeometry(0.6, 0.22, 0.05), exitMat, x, 4.6 + 0.3, BACK - 0.03);
  // projection booth windows
  const boothMat = new THREE.MeshBasicMaterial({ color: 0x57647a, fog: false });
  for (const x of [-1.2, 0, 1.2]) add(new THREE.BoxGeometry(0.5, 0.3, 0.05), boothMat, x, 6.8, BACK - 0.03);

  // ---------- seats ----------
  const N = ROWS * COLS;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  // padded shapes: a tall back with a round top, a thick cushion, wooden armrests with cup holders
  const cushion = new THREE.InstancedMesh(roundedBox(0.5, 0.16, 0.54, 0.07, 0.05, 0.035), seatMat, N);
  const back = new THREE.InstancedMesh(roundedBox(0.52, 0.74, 0.15, 0.2, 0.05, 0.045), seatMat, N);
  const arms = new THREE.InstancedMesh(roundedBox(0.075, 0.07, 0.54, 0.02, 0.02, 0.015), armMat, N * 2);
  const cups = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.04, 0.05, 16, 1, true), seatBaseMat, N * 2);
  const bases = new THREE.InstancedMesh(unit, seatBaseMat, N);
  const place = (mesh, k, x, y, z, sx, sy, sz, rx = 0) => {
    dummy.position.set(x, y, z); dummy.rotation.set(rx, 0, 0); dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix);
  };
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const k = i * COLS + j, x = seatX(j), y = rowY(i), z = rowZ(i);
    // the cushion shape is built upright (thin in Y after the turn below), so lay it flat
    place(cushion, k, x, y + 0.46, z - 0.02, 1, 1, 1, -0.04);
    place(back, k, x, y + 0.87, z + 0.29, 1, 1, 1, 0.14);
    place(arms, k * 2, x - 0.29, y + 0.67, z + 0.02, 1, 1, 1);
    place(arms, k * 2 + 1, x + 0.29, y + 0.67, z + 0.02, 1, 1, 1);
    place(cups, k * 2, x - 0.29, y + 0.72, z - 0.2, 1, 1, 1);
    place(cups, k * 2 + 1, x + 0.29, y + 0.72, z - 0.2, 1, 1, 1);
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
  [cushion, back, arms, cups, bases].forEach((m) => root.add(m));

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
    l.position.set(0, HH - 0.7, z); scene.add(l); return l;
  });
  // picture light: left, middle and right third of the screen, plus the bounce off the ceiling
  const screenLights = [[-4.6, SCREEN.cy, 2.6], [0, SCREEN.cy, 3.0], [4.6, SCREEN.cy, 2.6], [0, HH - 1.2, 4.2]].map((p) => {
    const l = new THREE.PointLight(0x9fc0ff, 0, 0, 2);
    l.position.set(...p); scene.add(l); return l;
  });

  const lampOn = new THREE.Color(0xffb56a), lampOff = new THREE.Color(0x6a3c1c);
  const downOn = new THREE.Color(0xffd9a8), downOff = new THREE.Color(0x1e1610);

  let house = 1;
  function setHouse(h) {
    house = h;
    hemi.intensity = 0.1 + 3.3 * h;
    for (const l of downLights) l.intensity = 40 * h;
    haloMat.opacity = 0.04 + 0.96 * h;
    lampMat.color.copy(lampOff).lerp(lampOn, 0.05 + 0.95 * h);
    downMat.color.copy(downOff).lerp(downOn, h);
    scene.fog.color.setRGB(0.08 * (0.12 + h), 0.05 * (0.12 + h), 0.04 * (0.12 + h));
  }
  setHouse(1);

  const cool = new THREE.Color(0x86aaff), warm = new THREE.Color(0xffb57a), tmp = new THREE.Color();
  // soft patches of picture light on the ceiling and on the floor in front of the screen
  const bounceCeil = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0x000000 });
  const bounceFloor = bounceCeil.clone();
  add(new THREE.PlaneGeometry(SCREEN.w * 1.25, 9), bounceCeil, 0, HH - 0.03, 3.6, Math.PI / 2);
  add(new THREE.PlaneGeometry(SCREEN.w * 1.1, 7), bounceFloor, 0, 0.03, 4.2, -Math.PI / 2);
  const avg = new THREE.Color();
  const sat = (c, k) => { const m = (c.r + c.g + c.b) / 3; c.r = Math.max(0, m + (c.r - m) * k); c.g = Math.max(0, m + (c.g - m) * k); c.b = Math.max(0, m + (c.b - m) * k); };
  // cols: three [r, g, b] values (0..1, sRGB) for the left, middle and right third of the picture
  function setScreenLight(cols, level) {
    avg.setRGB(0, 0, 0);
    for (let n = 0; n < 3; n++) {
      tmp.setRGB(cols[n][0], cols[n][1], cols[n][2], THREE.SRGBColorSpace);
      avg.r += tmp.r / 3; avg.g += tmp.g / 3; avg.b += tmp.b / 3;
      sat(tmp, 1.35);
      screenLights[n].color.copy(tmp);
      screenLights[n].intensity = level * 150;
    }
    sat(avg, 1.3);
    screenLights[3].color.copy(avg);
    screenLights[3].intensity = level * 70;
    bounceCeil.color.copy(avg).multiplyScalar(level * 0.55);
    bounceFloor.color.copy(avg).multiplyScalar(level * 0.4);
  }
  // no real picture available: a slow drift around the tint of the video (its thumbnail colour)
  const tint = [0.55, 0.62, 0.8], fake = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  function setTint(r, g, b) { tint[0] = r; tint[1] = g; tint[2] = b; }
  function updateGlow(t, level) {
    for (let n = 0; n < 3; n++) {
      const f = 0.62 + 0.2 * Math.sin(t * 0.9 + n * 1.7) * Math.sin(t * 0.31 + n) + 0.1 * Math.sin(t * 2.3 + n * 0.8);
      const w = 0.5 + 0.5 * Math.sin(t * 0.23 + n * 2.1);
      fake[n][0] = tint[0] * f * (0.9 + 0.2 * w); fake[n][1] = tint[1] * f; fake[n][2] = tint[2] * f * (1.1 - 0.2 * w);
    }
    setScreenLight(fake, level);
  }

  return {
    hole, cushion, back,
    setHouse, updateGlow, setScreenLight, setTint, setAudience,
    get house() { return house; },
    get hover() { return hovered; },
    setSelected(k) { const p = selected; selected = k; if (p >= 0) paint(p); if (k >= 0) paint(k); flush(); },
    setHover(k) { if (k === hovered) return; const p = hovered; hovered = k; if (p >= 0) paint(p); if (k >= 0) paint(k); flush(); },
  };
}
