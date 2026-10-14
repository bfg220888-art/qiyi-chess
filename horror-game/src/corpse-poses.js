// 屍體姿勢的資料（關卡生成與載入器共用，不依賴 three.js）。
// avatars：有烘這個姿勢的人物；hang：身體垂到床外多遠（公尺，床邊要有這麼多空位）；gurney：推床放得下
// 每個烘好的網格在床座標裡的頭腳範圍（z，公尺；頭在 -z）。重新烘焙後照 bake.html 的紀錄更新
export const CORPSE_EXTENT = {
  m021_supine: [-0.79, 1.02], m021_dangle: [-0.67, 1.14], m021_rigor: [-0.63, 1.18], m021_halfoff: [-0.03, 0.67],
  f002_curled: [-0.70, 0.74], f002_prone: [-0.84, 1.01], f002_supine: [-0.58, 1.14], f002_slumped: [-0.53, 0.50],
  m162_dangle: [-0.80, 1.02], m162_prone: [-0.95, 0.98], m162_supine: [-0.68, 1.15],
};

// 病床有床頭板與床尾板（內側約 ±0.955 公尺）：沿著床的方向挪多少，頭和腳才不會穿出去。推床兩端是空的，不用挪
export function corpseShift(name, kind) {
  const e = CORPSE_EXTENT[name];
  if (!e || kind === 'gurney') return 0;
  const [min, max] = e, lim = 0.93;
  if (max - min > 2 * lim) return -(min + max) / 2;
  if (max > lim) return lim - max;
  if (min < -lim) return -lim - min;
  return 0;
}

export const CORPSE_POSES = {
  supine: { avatars: ['m021', 'f002', 'm162'], hang: 0, gurney: true, w: 3 },
  dangle: { avatars: ['m021', 'm162'], hang: 0.6, gurney: true, w: 2 },
  curled: { avatars: ['f002'], hang: 0, gurney: true, w: 1.5 },
  prone: { avatars: ['f002', 'm162'], hang: 0, gurney: true, w: 1.5 },
  rigor: { avatars: ['m021'], hang: 0, gurney: true, w: 1 },
  halfoff: { avatars: ['m021'], hang: 0.9, gurney: false, w: 1.5 },
  slumped: { avatars: ['f002'], hang: 0, gurney: false, w: 1.2 },
};
