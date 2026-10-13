// 材質表：PBR 材質全部共用，靜態物件依材質合併以減少 draw call
import * as THREE from 'three';

const std = (o) => new THREE.MeshStandardMaterial(o);

function stripes() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a91e'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#121212';
  for (let k = -128; k < 256; k += 40) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 20, 0); g.lineTo(k + 20 + 128, 128); g.lineTo(k + 128, 128); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createMaterials(tf) {
  const wall = tf.wall(), vinyl = tf.floorVinyl(), tile = tf.floorTile(), ceil = tf.ceiling();
  const door = tf.door(), locker = tf.lockerDoor(), paint = tf.paintedMetal(), steel = tf.steel();
  const fabric = tf.fabric(), wood = tf.wood(), grime = tf.grime();
  const paperA = tf.paperAtlas();

  const M = {};
  M.wall = std({ ...wall, vertexColors: true, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) });
  M.floorVinyl = std({ ...vinyl, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.floorTile = std({ ...tile, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.7, 0.7) });
  M.floorLobby = std({ ...vinyl, color: 0xb9b0a0, roughness: 0.85, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.ceiling = std({ ...ceil, color: 0xd8d5cc, roughness: 1, metalness: 0 });
  M.door = std({ ...door, roughness: 1, metalness: 0.25 });
  M.lockerDoor = std({ ...locker, roughness: 1, metalness: 0.35 });
  M.paint = std({ ...paint, color: 0x75806f, roughness: 1, metalness: 0.35 });
  M.paintWhite = std({ ...paint, color: 0xd2d3cc, roughness: 1, metalness: 0.2 });
  M.paintYellow = std({ ...paint, color: 0xb2942c, roughness: 1, metalness: 0.3 });
  M.hazard = std({ map: stripes(), roughness: 0.6, metalness: 0.2 });
  M.steel = std({ ...steel, color: 0xc4c8cb, roughness: 1, metalness: 0.85 });
  M.brass = std({ color: 0xb08d57, roughness: 0.35, metalness: 0.9 });
  M.rubber = std({ color: 0x121212, roughness: 0.9, metalness: 0 });
  M.fabric = std({ ...fabric, roughness: 1, metalness: 0 });
  M.curtain = std({ ...fabric, color: 0x9fb4a8, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  M.mattress = std({ map: fabric.map, normalMap: fabric.normalMap, color: 0x4f7c80, roughness: 0.6, metalness: 0 });
  M.leather = std({ map: grime.map, color: 0x23302f, roughness: 0.55, metalness: 0 });
  M.leatherBrown = std({ map: grime.map, color: 0x3b2618, roughness: 0.6, metalness: 0 });
  M.wood = std({ ...wood, roughness: 1, metalness: 0 });
  M.plasticDark = std({ map: grime.map, color: 0x2c2f30, roughness: 0.6, metalness: 0 });
  M.plasticBlue = std({ map: grime.map, color: 0x3d5875, roughness: 0.5, metalness: 0 });
  M.plasticBeige = std({ map: grime.map, color: 0xb6ae96, roughness: 0.55, metalness: 0 });
  M.plasticWhite = std({ map: grime.map, color: 0xdedbd2, roughness: 0.5, metalness: 0 });
  M.plasticRed = std({ map: grime.map, color: 0x7a1510, roughness: 0.4, metalness: 0 });
  M.cardboard = std({ map: grime.map, roughnessMap: grime.roughnessMap, color: 0x8f6e47, roughness: 1, metalness: 0 });
  M.glass = std({ color: 0x0a0e10, roughness: 0.06, metalness: 0.2 });
  M.bottle = std({ color: 0x5c300c, roughness: 0.12, metalness: 0.1 });
  M.bottleGreen = std({ color: 0x1f3a22, roughness: 0.08, metalness: 0.1, emissive: 0x0b1a0d, emissiveIntensity: 1 });
  M.ivbag = std({ color: 0xc9d8d0, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.65 });
  M.porcelain = std({ map: grime.map, color: 0xe0e0da, roughness: 0.18, metalness: 0 });
  M.mirror = std({ map: grime.map, color: 0x7a8285, roughness: 0.1, metalness: 1 });
  M.dark = std({ color: 0x0b0b0b, roughness: 0.8, metalness: 0 });
  M.ceramicPot = std({ map: grime.map, color: 0x6b4a36, roughness: 0.7, metalness: 0 });
  M.deadPlant = std({ color: 0x241b10, roughness: 0.9, metalness: 0 });
  M.screen = std({ color: 0x0a0d0d, roughness: 0.08, metalness: 0.1 });
  M.lampOff = std({ color: 0x8a8a80, roughness: 0.3, metalness: 0.1 });
  M.lampRed = std({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 1.3, roughness: 0.3 });
  M.socket = std({ color: 0x101010, roughness: 0.6, metalness: 0.3 });
  M.fuseGlass = std({ color: 0xd8c49a, emissive: 0xff8a20, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0 });
  M.fuseWire = std({ color: 0xffb060, emissive: 0xff9030, emissiveIntensity: 3, roughness: 0.5 });
  M.batteryBody = std({ map: grime.map, color: 0x1d4f8a, roughness: 0.35, metalness: 0.3 });
  M.filmBox = std({ map: grime.map, color: 0xd6b21e, roughness: 0.5, metalness: 0 });
  M.noteMat = std({ map: paperA.map, color: 0xf2ead2, emissive: 0x2a2620, emissiveIntensity: 1, roughness: 0.9, metalness: 0 });
  M.paperMat = std({ map: grime.map, color: 0xd6d0ba, roughness: 0.9, metalness: 0 });
  M.skin = std({ map: tf.ghostSkin().map, color: 0xb9c0c4, roughness: 0.55, metalness: 0 });
  M.tube = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
  M.emergency = std({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 3, roughness: 0.4 });
  M.exit = new THREE.MeshBasicMaterial({ map: tf.exitSign().map, toneMapped: true });
  M.exit.color.setRGB(1.6, 1.6, 1.6);
  const win = tf.windowTex();
  M.window = std({ map: win.map, emissiveMap: win.map, emissive: 0xffffff, emissiveIntensity: 0.35, color: 0x222222, roughness: 0.08, metalness: 0.1 });
  M.tvScreen = new THREE.MeshBasicMaterial({ color: 0x8a9a9a, toneMapped: true });
  // 靜態合併時，顏色不同但其他參數相近的材質合併成一個（顏色烘進頂點色）以減少 draw call
  M.matte = std({ map: grime.map, roughnessMap: grime.roughnessMap, roughness: 0.9, metalness: 0, vertexColors: true });
  M.glossy = std({ roughness: 0.1, metalness: 0.12, vertexColors: true });
  M.paintTint = std({ ...paint, roughness: 1, metalness: 0.3, vertexColors: true });
  for (const k of ['leather', 'leatherBrown', 'plasticDark', 'plasticBlue', 'plasticBeige', 'plasticWhite', 'plasticRed', 'cardboard', 'ceramicPot', 'deadPlant', 'dark', 'paperMat', 'rubber']) M[k].userData.bakeAs = M.matte;
  for (const k of ['glass', 'bottle', 'screen']) M[k].userData.bakeAs = M.glossy;
  for (const k of ['paint', 'paintWhite', 'paintYellow']) M[k].userData.bakeAs = M.paintTint;
  M.decalBase = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  M.blood = std({ map: tf.bloodAtlas().map, roughness: 0.28, metalness: 0, ...M.decalBase });
  M.drag = std({ map: tf.dragAtlas().map, roughness: 0.35, metalness: 0, ...M.decalBase });
  M.hand = std({ map: tf.handAtlas().map, roughness: 0.5, metalness: 0, ...M.decalBase });
  M.paper = std({ map: paperA.map, roughness: 0.9, metalness: 0, ...M.decalBase, alphaTest: 0.05 });
  return M;
}

// 把關卡的牆畫成平面圖（大廳的疏散圖與遊戲中的地圖都用它）
export function drawFloorPlan(g, lv, opts) {
  const { x0, y0, scale, explored, wallColor = '#2b2b2b', floorColor = 'rgba(0,0,0,0)', doorColor = '#7a6a4a', lineWidth = 2, roomColor, labels } = opts;
  const CELL = 3;
  const tx = (x) => x0 + x * scale, ty = (z) => y0 + z * scale;
  for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const id = lv.cellAt(x, y);
    if (id < 0) continue;
    if (explored && !explored[y * lv.W + x]) continue;
    g.fillStyle = (roomColor && roomColor(lv.rooms[id])) || floorColor;
    g.fillRect(tx(x * CELL), ty(y * CELL), CELL * scale + 0.5, CELL * scale + 0.5);
    if (lv.blockedCell[y * lv.W + x]) {
      g.strokeStyle = wallColor; g.lineWidth = lineWidth * 0.7;
      g.beginPath();
      g.moveTo(tx(x * CELL + 0.4), ty(y * CELL + 0.4)); g.lineTo(tx(x * CELL + 2.6), ty(y * CELL + 2.6));
      g.moveTo(tx(x * CELL + 2.6), ty(y * CELL + 0.4)); g.lineTo(tx(x * CELL + 0.4), ty(y * CELL + 2.6));
      g.stroke();
    }
  }
  const seenCell = (x, y) => !explored || (lv.inBounds(x, y) && explored[y * lv.W + x]);
  g.lineCap = 'square';
  for (let y = 0; y <= lv.H; y++) for (let x = 0; x < lv.W; x++) {
    const t = lv.hEdge(x, y);
    if (!(t === 1 || t === 2 || t === 3 || t === 5)) continue;
    if (!seenCell(x, y) && !seenCell(x, y - 1)) continue;
    const ax = tx(x * CELL), bx = tx((x + 1) * CELL), yy = ty(y * CELL);
    g.strokeStyle = wallColor; g.lineWidth = lineWidth;
    if (t === 2 || t === 5) {
      const w = t === 2 ? 1.2 : 2.4;
      const m = (x + 0.5) * CELL;
      g.beginPath(); g.moveTo(ax, yy); g.lineTo(tx(m - w / 2), yy); g.moveTo(tx(m + w / 2), yy); g.lineTo(bx, yy); g.stroke();
      g.strokeStyle = doorColor; g.lineWidth = lineWidth * 0.6;
      g.beginPath(); g.moveTo(tx(m - w / 2), yy); g.lineTo(tx(m + w / 2), yy); g.stroke();
    } else {
      g.beginPath(); g.moveTo(ax, yy); g.lineTo(bx, yy); g.stroke();
    }
  }
  for (let y = 0; y < lv.H; y++) for (let x = 0; x <= lv.W; x++) {
    const t = lv.vEdge(x, y);
    if (!(t === 1 || t === 2 || t === 3)) continue;
    if (!seenCell(x, y) && !seenCell(x - 1, y)) continue;
    const ay = ty(y * CELL), by = ty((y + 1) * CELL), xx = tx(x * CELL);
    g.strokeStyle = wallColor; g.lineWidth = lineWidth;
    if (t === 2) {
      const m = (y + 0.5) * CELL;
      g.beginPath(); g.moveTo(xx, ay); g.lineTo(xx, ty(m - 0.6)); g.moveTo(xx, ty(m + 0.6)); g.lineTo(xx, by); g.stroke();
      g.strokeStyle = doorColor; g.lineWidth = lineWidth * 0.6;
      g.beginPath(); g.moveTo(xx, ty(m - 0.6)); g.lineTo(xx, ty(m + 0.6)); g.stroke();
    } else {
      g.beginPath(); g.moveTo(xx, ay); g.lineTo(xx, by); g.stroke();
    }
  }
  if (labels) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const room of lv.rooms) {
      if (room.id === 0) continue;
      if (explored && !explored[room.y0 * lv.W + room.x0]) continue;
      const text = labels(room);
      if (!text) continue;
      g.fillStyle = opts.labelColor || '#333';
      g.font = opts.labelFont || `${Math.max(9, scale * 1.1)}px sans-serif`;
      g.fillText(text, tx(room.cx), ty(room.cz));
    }
  }
}
