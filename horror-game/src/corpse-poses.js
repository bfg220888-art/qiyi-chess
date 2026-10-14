// 屍體姿勢的資料（關卡生成與載入器共用，不依賴 three.js）。
// avatars：有烘這個姿勢的人物；hang：身體垂到床外多遠（公尺，床邊要有這麼多空位）；gurney：推床放得下
export const CORPSE_POSES = {
  supine: { avatars: ['m021', 'f002', 'm162'], hang: 0, gurney: true, w: 3 },
  dangle: { avatars: ['m021', 'm162'], hang: 0.6, gurney: true, w: 2 },
  curled: { avatars: ['f002'], hang: 0, gurney: true, w: 1.5 },
  prone: { avatars: ['f002', 'm162'], hang: 0, gurney: true, w: 1.5 },
  rigor: { avatars: ['m021'], hang: 0, gurney: true, w: 1 },
  halfoff: { avatars: ['m021'], hang: 0.9, gurney: false, w: 1.5 },
  slumped: { avatars: ['f002'], hang: 0, gurney: false, w: 1.2 },
};
