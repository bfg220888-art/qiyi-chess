// 把 GLTFExporter 輸出的 GLB 再壓小一點（不需要任何解碼器，GLTFLoader 直接讀）：
// - 同一段動作的各軌道時間陣列一模一樣：合併成一份
// - 旋轉關鍵格改存 int16 正規化（glTF 核心規格允許），大小減半
// - 刪掉非必要的 min / max，數字四捨五入到 7 位有效數字
// - 重新排列二進位資料，丟掉沒用到的部分
export function compactGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  const viewBytes = (bvIdx) => { const bv = j.bufferViews[bvIdx]; return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); };
  // 每個 accessor 的新資料（Buffer），最後重新寫入
  const data = j.accessors.map((a) => Buffer.from(viewBytes(a.bufferView)));
  const isInput = new Set(), rotOut = new Set();
  for (const an of j.animations || []) {
    for (const ch of an.channels) if (ch.target.path === 'rotation') rotOut.add(an.samplers[ch.sampler].output);
    for (const s of an.samplers) isInput.add(s.input);
  }
  // 旋轉 → int16 正規化
  for (const i of rotOut) {
    const a = j.accessors[i];
    if (a.componentType !== 5126) continue;
    const f = new Float32Array(data[i].buffer.slice(data[i].byteOffset, data[i].byteOffset + data[i].byteLength));
    const s = new Int16Array(f.length);
    for (let k = 0; k < f.length; k++) s[k] = Math.round(Math.max(-1, Math.min(1, f[k])) * 32767);
    data[i] = Buffer.from(s.buffer);
    a.componentType = 5122;
    a.normalized = true;
    delete a.min; delete a.max;
  }
  // 合併相同的時間陣列
  const seen = new Map(), remap = new Map();
  for (const i of isInput) {
    const key = data[i].toString('base64');
    if (seen.has(key)) remap.set(i, seen.get(key)); else seen.set(key, i);
  }
  for (const an of j.animations || []) for (const s of an.samplers) if (remap.has(s.input)) s.input = remap.get(s.input);
  // 收集用到的 accessor
  const used = new Set();
  const use = (i) => { if (i !== undefined) used.add(i); };
  for (const m of j.meshes || []) for (const p of m.primitives) { Object.values(p.attributes).forEach(use); use(p.indices); }
  for (const s of j.skins || []) use(s.inverseBindMatrices);
  for (const an of j.animations || []) for (const s of an.samplers) { use(s.input); use(s.output); }
  const posAcc = new Set();
  for (const m of j.meshes || []) for (const p of m.primitives) posAcc.add(p.attributes.POSITION);
  const newAcc = [], accMap = new Map(), views = [], chunks = [];
  let off = 0;
  [...used].sort((a, b) => a - b).forEach((i) => {
    const a = { ...j.accessors[i] };
    const bvOld = j.bufferViews[a.bufferView];
    const d = data[i];
    const view = { buffer: 0, byteOffset: off, byteLength: d.length };
    if (bvOld.target) view.target = bvOld.target;
    if (bvOld.byteStride) view.byteStride = bvOld.byteStride;
    a.bufferView = views.length;
    delete a.byteOffset;
    if (!posAcc.has(i) && !isInput.has(i)) { delete a.min; delete a.max; }
    views.push(view);
    chunks.push(d);
    const pad = (4 - (d.length % 4)) % 4;
    if (pad) chunks.push(Buffer.alloc(pad));
    off += d.length + pad;
    accMap.set(i, newAcc.length);
    newAcc.push(a);
  });
  const R = (i) => accMap.get(i);
  for (const m of j.meshes || []) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = R(p.attributes[k]);
    if (p.indices !== undefined) p.indices = R(p.indices);
  }
  for (const s of j.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = R(s.inverseBindMatrices);
  for (const an of j.animations || []) for (const s of an.samplers) { s.input = R(s.input); s.output = R(s.output); }
  j.accessors = newAcc;
  j.bufferViews = views;
  const newBin = Buffer.concat(chunks);
  j.buffers = [{ byteLength: newBin.length }];
  // 數字取 7 位有效數字；接近 1 的縮放直接刪掉
  for (const n of j.nodes || []) if (n.scale && n.scale.every((v) => Math.abs(v - 1) < 1e-5)) delete n.scale;
  const text = JSON.stringify(j, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(7) : v));
  let jb = Buffer.from(text, 'utf8');
  if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jb.length + 8 + newBin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jb, bh, newBin]);
}
