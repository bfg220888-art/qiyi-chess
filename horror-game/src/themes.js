// 樓層主題：每一局選一個，決定格局、房間組成、牆面地板、燈光顏色、道具與貼花。
// 純資料（不碰 DOM / three.js），關卡生成與 Node 測試都會用到。
//
// 決定性：同一組 (seed, difficulty, theme) 一定生出同一張地圖。
// theme 是 'random'（或任何不認得的值）時，先用 seed 決定主題再生成，
// 所以多人連線只要傳 seed 與玩家選的 theme（或已解析好的主題 key）就能得到一模一樣的樓層。

export const THEME_KEYS = ['ward', 'morgue', 'pediatric', 'psych'];
export const RANDOM_THEME = 'random';

// 房型權重：big = 面積 ≥ 4 格，mid = 2～3 格，small = 1 格
export const THEMES = {
  // -------------------------------------------------------------------------
  ward: {
    key: 'ward', name: '七樓病房區', floor: '7F', short: '病房',
    desc: '長走廊、成排的病床與隔簾。一切開始的地方。',
    intro: '二十年後，你帶著攝影機獨自走進七樓，想拍下傳說中「哼歌的女人」。',
    board: '七樓',
    layout: {
      margin: 2, cols: [3, 3], rows: [3, 3], blockW: [4, 5], blockH: [3, 4],
      seg: { p3: 0.3, p1: 0.12 }, fullDepth: 0.4, hall: 0, hallMax: 0,
      wideRow: 0, wideCol: 0, notch: 0.22, courtyard: 0.12, spurs: [0, 1],
    },
    rooms: {
      nurse: true,
      specials: [['operating', 0.9], ['morgue', 0.85]],
      big: [['ward', 0.55], ['office', 0.25], ['storage', 0.2]],
      mid: [['office', 0.32], ['storage', 0.26], ['ward', 0.26], ['utility', 0.16]],
      small: [['storage', 0.55], ['utility', 0.45]],
      numbered: { type: 'ward', start: 701, skip: [707], fmt: (n) => `${n} 病房` },
      special: { types: ['ward'], label: '707 病房', tag: '707' },
      names: {},
    },
    windows: 0.42, lobbyWindows: 0.5, corrWindows: 0.35,
    lights: { corrEvery: 2, broken: 0.46, flicker: 0.35, color: 0xdfe8ff, tube: [0.92, 0.97, 1], emergency: 0xff2a14, emergencyN: 5 },
    look: {
      fog: 0x000000, fogDensity: 0.055, hemiSky: 0x4a5a6a, hemiGround: 0x0a0806,
      wall: { default: 'paint' }, wallTint: 0xffffff,
      floor: { corridor: 'vinyl', default: 'tile', office: 'vinyl', nurse: 'vinyl', lobby: 'lobby' },
      floorTint: { vinyl: 0xffffff, tile: 0xffffff },
      ceiling: 0xd8d5cc, door: 0xffffff,
    },
    decor: { blood: 0.12, paper: 0.35, writings: 5, hands: 7, drawings: 0, toys: 0, drains: 0, corridorBodies: 0.35 },
  },

  // -------------------------------------------------------------------------
  morgue: {
    key: 'morgue', name: '地下太平間', floor: 'B1', short: '太平間',
    desc: '冷藏櫃、解剖台、地上的排水孔。這裡比樓上冷很多。',
    intro: '二十年後，你帶著攝影機從卸貨坡道走進地下一樓的太平間，想拍下傳說中「哼歌的女人」。',
    board: '地下一樓',
    layout: {
      margin: 3, cols: [2, 3], rows: [2, 3], blockW: [4, 6], blockH: [3, 4],
      seg: { p3: 0.55, p1: 0.05 }, fullDepth: 0.55, hall: 0.25, hallMax: 15,
      wideRow: 0.75, wideCol: 0.25, notch: 0.2, courtyard: 0, spurs: [1, 2],
    },
    rooms: {
      nurse: true,
      specials: [['autopsy', 1], ['coldstore', 0.9]],
      big: [['morgue', 0.45], ['coldstore', 0.25], ['autopsy', 0.15], ['storage', 0.15]],
      mid: [['morgue', 0.4], ['autopsy', 0.1], ['storage', 0.2], ['office', 0.15], ['utility', 0.15]],
      small: [['storage', 0.5], ['utility', 0.5]],
      numbered: { type: 'morgue', start: 0, skip: [], fmt: (n) => `冷藏室 ${'ABCDEFGHJKLM'[n % 12]}` },
      special: { types: ['morgue', 'coldstore'], label: '0713 冷藏室', tag: '0713' },
      names: { nurse: '管理室', office: '病理科辦公室', storage: '屍袋倉庫', utility: '鍋爐間', lobby: '卸貨區' },
    },
    windows: 0, lobbyWindows: 0, corrWindows: 0,
    lights: { corrEvery: 3, broken: 0.55, flicker: 0.45, color: 0xb8f0e4, tube: [0.78, 1.0, 0.95], emergency: 0x22ff66, emergencyN: 6 },
    look: {
      fog: 0x020a0b, fogDensity: 0.06, hemiSky: 0x3a6a66, hemiGround: 0x020606,
      wall: { default: 'tileWall' }, wallTint: 0xffffff,
      floor: { corridor: 'tile', default: 'tile', office: 'vinyl', nurse: 'vinyl', lobby: 'tile' },
      floorTint: { vinyl: 0x9aa6a2, tile: 0xa8b8b6 },
      ceiling: 0x7f8a88, door: 0xb9c6c6,
    },
    decor: { blood: 0.1, paper: 0.18, writings: 4, hands: 6, drawings: 0, toys: 0, drains: 0.22, corridorBodies: 0.7 },
  },

  // -------------------------------------------------------------------------
  pediatric: {
    key: 'pediatric', name: '兒童病房', floor: '4F', short: '兒童',
    desc: '剝落的粉彩壁紙、小床與散落的玩具。牆上貼滿孩子的蠟筆畫。',
    intro: '二十年後，你帶著攝影機獨自走進四樓的兒童病房，想拍下傳說中「哼歌的女人」。',
    board: '四樓兒童病房',
    layout: {
      margin: 2, cols: [3, 3], rows: [2, 3], blockW: [4, 6], blockH: [3, 5],
      seg: { p3: 0.4, p1: 0.08 }, fullDepth: 0.45, hall: 0.18, hallMax: 15,
      wideRow: 0.15, wideCol: 0, notch: 0.3, courtyard: 0.3, spurs: [0, 2],
    },
    rooms: {
      nurse: true,
      specials: [['playroom', 0.95], ['nursery', 0.85]],
      big: [['kidward', 0.55], ['nursery', 0.2], ['playroom', 0.1], ['storage', 0.15]],
      mid: [['kidward', 0.4], ['office', 0.18], ['storage', 0.17], ['nursery', 0.15], ['utility', 0.1]],
      small: [['storage', 0.5], ['utility', 0.5]],
      numbered: { type: 'kidward', start: 401, skip: [404, 413], fmt: (n) => `${n} 病房` },
      special: { types: ['nursery', 'kidward'], label: '嬰兒室', tag: '嬰兒室' },
      names: { office: '小兒科辦公室', lobby: '候診大廳' },
    },
    windows: 0.5, lobbyWindows: 0.6, corrWindows: 0.45,
    lights: { corrEvery: 2, broken: 0.5, flicker: 0.3, color: 0xffe2bc, tube: [1.0, 0.9, 0.76], emergency: 0xff2a14, emergencyN: 4 },
    look: {
      fog: 0x070403, fogDensity: 0.055, hemiSky: 0x6a5848, hemiGround: 0x0a0604,
      wall: { default: 'wallpaper' }, wallTint: 0xffffff,
      floor: { corridor: 'vinyl', default: 'kidFloor', office: 'vinyl', nurse: 'vinyl', storage: 'tile', utility: 'tile', lobby: 'lobby' },
      floorTint: { vinyl: 0xd8c8a8, tile: 0xffffff },
      ceiling: 0xe0d6c4, door: 0xe8cfa0,
    },
    decor: { blood: 0.08, paper: 0.3, writings: 4, hands: 5, drawings: 14, toys: 3, drains: 0, corridorBodies: 0.4 },
  },

  // -------------------------------------------------------------------------
  psych: {
    key: 'psych', name: '精神科隔離區', floor: '9F', short: '精神科',
    desc: '軟墊隔離室、束縛床、觀察窗與鐵籠般的護理站。',
    intro: '二十年後，你帶著攝影機獨自走進九樓的精神科隔離區，想拍下傳說中「哼歌的女人」。',
    board: '九樓精神科',
    layout: {
      margin: 2, cols: [3, 4], rows: [2, 3], blockW: [3, 5], blockH: [3, 4],
      seg: { p3: 0.12, p1: 0.45 }, fullDepth: 0.3, hall: 0.12, hallMax: 12,
      wideRow: 0.1, wideCol: 0, notch: 0.2, courtyard: 0.4, spurs: [1, 2],
    },
    rooms: {
      nurse: true,
      specials: [['dayroom', 0.95], ['therapy', 0.85]],
      big: [['office', 0.3], ['storage', 0.25], ['cell', 0.2], ['dayroom', 0.13], ['therapy', 0.12]],
      mid: [['cell', 0.55], ['office', 0.15], ['storage', 0.15], ['therapy', 0.07], ['utility', 0.08]],
      small: [['cell', 0.8], ['utility', 0.2]],
      numbered: { type: 'cell', start: 901, skip: [904], fmt: (n) => `${n} 隔離室` },
      special: { types: ['cell'], label: '0713 隔離室', tag: '0713' },
      names: { nurse: '護理站', office: '精神科醫師室' },
    },
    windows: 0.3, lobbyWindows: 0.4, corrWindows: 0.5,
    lights: { corrEvery: 2, broken: 0.42, flicker: 0.4, color: 0xe8ffe0, tube: [0.9, 1.0, 0.86], emergency: 0xff2a14, emergencyN: 5 },
    look: {
      fog: 0x040604, fogDensity: 0.055, hemiSky: 0x56604a, hemiGround: 0x080806,
      wall: { default: 'paint', cell: 'padded' }, wallTint: 0xe6dcae,
      floor: { corridor: 'vinyl', default: 'vinyl', cell: 'padded', utility: 'tile', storage: 'tile', therapy: 'tile', lobby: 'lobby' },
      floorTint: { vinyl: 0xb8b8a0, tile: 0xffffff },
      ceiling: 0xcfcfbc, door: 0x9aa6a8,
    },
    decor: { blood: 0.1, paper: 0.4, writings: 7, hands: 9, drawings: 0, toys: 0, drains: 0, corridorBodies: 0.35 },
  },
};

// 把玩家選的主題解析成實際的主題 key。'random' 時只用 seed 決定（不消耗關卡的亂數）
export function resolveTheme(theme, seed) {
  if (theme && THEMES[theme]) return theme;
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return THEME_KEYS[h % THEME_KEYS.length];
}

// 顯示用：「B1 地下太平間」
export const themeTitle = (key) => (THEMES[key] ? `${THEMES[key].floor} ${THEMES[key].name}` : '');
