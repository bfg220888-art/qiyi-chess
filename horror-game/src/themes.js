// 樓層主題：每一局選一個，決定格局、房間組成、牆面地板、燈光顏色、道具與貼花。
// 純資料（不碰 DOM / three.js），關卡生成與 Node 測試都會用到。
//
// 決定性：同一組 (seed, difficulty, theme) 一定生出同一張地圖。
// 多層樓時：第 0 層（有大門的那一層）用選的主題，其他樓層由 seed 挑不同的主題，
// 樓層上下的順序照各主題的樓層編號（level：B1 = -1、4F = 4……），所以太平間一定在最下面。
// theme 是 'random'（或任何不認得的值）時，先用 seed 決定主題再生成，
// 所以多人連線只要傳 seed 與玩家選的 theme（或已解析好的主題 key）就能得到一模一樣的樓層。

export const THEME_KEYS = ['ward', 'morgue', 'pediatric', 'psych', 'surgery', 'burned'];
export const RANDOM_THEME = 'random';

// 房型權重：big = 面積 ≥ 4 格，mid = 2～3 格，small = 1 格
//
// layout.topo：走廊拓樸的權重（每一局依 seed 抽一種，同一個主題也會有很不一樣的平面圖）
//   grid   = 棋盤格走廊（原本的格局，會再抽 L 形缺角 / U 形中庭）
//   broken = 棋盤格拆掉一部分走廊：大小不一的街區、更多死路
//   ring   = 一圈環狀走廊包著中央的大街區（中央房間只能從別的房間穿過去）
//   atrium = 環狀走廊＋中央挖空的天井（四面都是看得到天井的窗）
//   H      = 左右兩條直走廊、中間一條橫走廊，再從橫走廊往下接到大廳
//   spine  = 一條偏向一側的主走廊，兩旁伸出長短不一的側翼（魚骨形，很多死路）
// layout.roomMax：房間最長邊（格），非棋盤格的格局用它把街區切成大小不一的房間
export const THEMES = {
  // -------------------------------------------------------------------------
  ward: {
    key: 'ward', name: '七樓病房區', floor: '7F', level: 7, short: '病房',
    desc: '長走廊、成排的病床與隔簾。一切開始的地方。',
    intro: '二十年後，你帶著攝影機獨自走進七樓，想拍下傳說中「哼歌的女人」。',
    board: '七樓',
    layout: {
      margin: 2, cols: [3, 3], rows: [3, 3], blockW: [4, 5], blockH: [3, 4],
      seg: { p3: 0.3, p1: 0.12 }, fullDepth: 0.4, hall: 0, hallMax: 0,
      wideRow: 0, wideCol: 0, notch: 0.22, courtyard: 0.12, spurs: [0, 1],
      topo: [['grid', 0.4], ['broken', 0.2], ['ring', 0.12], ['atrium', 0.08], ['H', 0.1], ['spine', 0.1]], roomMax: 4,
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
    key: 'morgue', name: '地下太平間', floor: 'B1', level: -1, short: '太平間',
    desc: '冷藏櫃、解剖台、地上的排水孔。這裡比樓上冷很多。',
    intro: '二十年後，你帶著攝影機從卸貨坡道走進地下一樓的太平間，想拍下傳說中「哼歌的女人」。',
    board: '地下一樓',
    layout: {
      margin: 3, cols: [2, 3], rows: [2, 3], blockW: [4, 6], blockH: [3, 4],
      seg: { p3: 0.55, p1: 0.05 }, fullDepth: 0.55, hall: 0.25, hallMax: 15,
      wideRow: 0.75, wideCol: 0.25, notch: 0.2, courtyard: 0, spurs: [1, 2],
      topo: [['grid', 0.35], ['spine', 0.25], ['broken', 0.2], ['H', 0.1], ['ring', 0.1]], roomMax: 4,
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
    key: 'pediatric', name: '兒童病房', floor: '4F', level: 4, short: '兒童',
    desc: '剝落的粉彩壁紙、小床與散落的玩具。牆上貼滿孩子的蠟筆畫。',
    intro: '二十年後，你帶著攝影機獨自走進四樓的兒童病房，想拍下傳說中「哼歌的女人」。',
    board: '四樓兒童病房',
    layout: {
      margin: 2, cols: [3, 3], rows: [2, 3], blockW: [4, 6], blockH: [3, 5],
      seg: { p3: 0.4, p1: 0.08 }, fullDepth: 0.45, hall: 0.18, hallMax: 15,
      wideRow: 0.15, wideCol: 0, notch: 0.3, courtyard: 0.3, spurs: [0, 2],
      topo: [['grid', 0.35], ['atrium', 0.2], ['broken', 0.15], ['ring', 0.1], ['H', 0.1], ['spine', 0.1]], roomMax: 4,
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
    key: 'psych', name: '精神科隔離區', floor: '9F', level: 9, short: '精神科',
    desc: '軟墊隔離室、束縛床、觀察窗與鐵籠般的護理站。',
    intro: '二十年後，你帶著攝影機獨自走進九樓的精神科隔離區，想拍下傳說中「哼歌的女人」。',
    board: '九樓精神科',
    layout: {
      margin: 2, cols: [3, 4], rows: [2, 3], blockW: [3, 5], blockH: [3, 4],
      seg: { p3: 0.12, p1: 0.45 }, fullDepth: 0.3, hall: 0.12, hallMax: 12,
      wideRow: 0.1, wideCol: 0, notch: 0.2, courtyard: 0.4, spurs: [1, 2],
      topo: [['grid', 0.3], ['ring', 0.25], ['broken', 0.15], ['H', 0.15], ['spine', 0.15]], roomMax: 3,
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

  // -------------------------------------------------------------------------
  surgery: {
    key: 'surgery', name: '手術部', floor: '5F', level: 5, short: '手術',
    desc: '無影燈、刷手台、拉上隔簾的加護病床。消毒水味還沒散。',
    intro: '二十年後，你帶著攝影機獨自走進五樓的手術部，想拍下傳說中「哼歌的女人」。',
    board: '五樓手術部',
    layout: {
      margin: 2, cols: [3, 3], rows: [3, 3], blockW: [4, 6], blockH: [3, 4],
      seg: { p3: 0.45, p1: 0.08 }, fullDepth: 0.5, hall: 0.2, hallMax: 16,
      wideRow: 0.2, wideCol: 0.1, notch: 0.15, courtyard: 0.1, spurs: [0, 1],
      topo: [['ring', 0.3], ['atrium', 0.2], ['grid', 0.15], ['H', 0.15], ['broken', 0.1], ['spine', 0.1]],
      roomMax: 4, barricades: [1, 2],
    },
    rooms: {
      nurse: true,
      specials: [['operating', 1], ['icu', 0.95], ['scrub', 0.85], ['operating', 0.7]],
      big: [['icu', 0.3], ['recovery', 0.24], ['operating', 0.18], ['sterile', 0.14], ['storage', 0.14]],
      mid: [['scrub', 0.22], ['sterile', 0.22], ['recovery', 0.18], ['office', 0.16], ['storage', 0.12], ['utility', 0.1]],
      small: [['storage', 0.45], ['utility', 0.3], ['scrub', 0.25]],
      numbered: { type: 'operating', start: 1, skip: [7], fmt: (n) => `第 ${n} 手術室` },
      special: { types: ['operating'], label: '第 7 手術室', tag: '7 號房' },
      names: { nurse: '恢復室護理站', office: '麻醉科辦公室', storage: '衛材庫房', utility: '污物處理室', lobby: '手術部等候區' },
    },
    windows: 0.12, lobbyWindows: 0.4, corrWindows: 0.25,
    lights: { corrEvery: 2, broken: 0.4, flicker: 0.3, color: 0xe4f4ff, tube: [0.88, 0.98, 1.0], emergency: 0xff2a14, emergencyN: 5 },
    look: {
      fog: 0x01070a, fogDensity: 0.055, hemiSky: 0x3e6460, hemiGround: 0x040808,
      // 手術部是「手術綠」：走廊淺綠油漆，手術室與刷手間整面磁磚
      wall: { default: 'paint', operating: 'tileWall', scrub: 'tileWall', sterile: 'tileWall', utility: 'tileWall' },
      wallTint: 0xb4d6c6, wallTints: { tileWall: 0xd4ece6 },
      floor: { corridor: 'vinyl', default: 'vinyl', operating: 'tile', scrub: 'tile', sterile: 'tile', utility: 'tile', lobby: 'lobby' },
      floorTint: { vinyl: 0x9fb8ae, tile: 0xc6dcd6 },
      ceiling: 0xd2dcd6, door: 0xa8c8bc,
    },
    corridorProps: [['gurney', 4], ['trolley', 2.2], ['ivstand', 1.4], ['monitor', 1.2], ['wheelchair', 1], ['bin', 1], ['boxes', 0.8]],
    decor: { blood: 0.12, paper: 0.22, writings: 4, hands: 6, drawings: 0, toys: 0, drains: 0, corridorBodies: 0.45, stripCurtains: 3 },
  },

  // -------------------------------------------------------------------------
  burned: {
    key: 'burned', name: '燒毀的舊院區', floor: '3F', level: 3, short: '舊院區',
    desc: '那一夜之後燒毀的舊大樓。焦黑的牆、塌下的天花板。',
    intro: '二十年後，你帶著攝影機鑽過封鎖線，走進燒毀的舊院區三樓，想拍下傳說中「哼歌的女人」。',
    board: '舊院區三樓',
    layout: {
      margin: 2, cols: [3, 4], rows: [2, 3], blockW: [3, 5], blockH: [3, 4],
      seg: { p3: 0.3, p1: 0.1 }, fullDepth: 0.35, hall: 0.12, hallMax: 12,
      wideRow: 0.15, wideCol: 0, notch: 0.3, courtyard: 0.1, spurs: [1, 3],
      topo: [['broken', 0.38], ['spine', 0.22], ['grid', 0.15], ['H', 0.15], ['ring', 0.1]],
      roomMax: 4, barricades: [2, 4], rubble: true,
    },
    rooms: {
      nurse: true,
      specials: [['collapsed', 0.95], ['collapsed', 0.6]],
      big: [['ward', 0.45], ['collapsed', 0.25], ['storage', 0.15], ['office', 0.15]],
      mid: [['ward', 0.38], ['office', 0.18], ['storage', 0.16], ['collapsed', 0.16], ['utility', 0.12]],
      small: [['storage', 0.5], ['utility', 0.3], ['collapsed', 0.2]],
      numbered: { type: 'ward', start: 301, skip: [304, 313], fmt: (n) => `${n} 病房` },
      special: { types: ['ward', 'collapsed'], label: '313 病房', tag: '起火點' },
      names: { nurse: '燒毀的護理站', office: '值班室', storage: '被服室', utility: '配電間', lobby: '舊院區門廳' },
    },
    windows: 0.55, lobbyWindows: 0.6, corrWindows: 0.5,
    lights: { corrEvery: 2, broken: 0.6, flicker: 0.5, color: 0xffd6a8, tube: [1.0, 0.82, 0.62], emergency: 0xff6a12, emergencyN: 9 },
    look: {
      // 煙灰色的霧、餘燼般的橘色緊急燈
      fog: 0x1a1612, fogDensity: 0.068, hemiSky: 0x6a5240, hemiGround: 0x080504,
      wall: { default: 'charred' }, wallTint: 0xffffff,
      floor: { corridor: 'charred', default: 'charred', office: 'vinyl', storage: 'tile', utility: 'tile', lobby: 'charred' },
      floorTint: { vinyl: 0x5a5048, tile: 0x6a625a },
      ceiling: 0x3e3730, door: 0x5a4a3e,
      charred: true,
    },
    corridorProps: [['rubble', 3], ['gurney', 2], ['wheelchair', 1.5], ['beam', 1.4], ['chair', 1], ['boxes', 0.8], ['bin', 0.6]],
    decor: { blood: 0.06, paper: 0.18, writings: 4, hands: 9, drawings: 0, toys: 0, drains: 0, corridorBodies: 0.25, soot: 0.35, scorch: 0.3, boarded: 0.35 },
  },
};

// 把玩家選的主題解析成實際的主題 key。'random' 時只用 seed 決定（不消耗關卡的亂數）
export function resolveTheme(theme, seed) {
  if (typeof theme === 'string' && Object.hasOwn(THEMES, theme)) return theme;
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return THEME_KEYS[h % THEME_KEYS.length];
}

// 顯示用：「B1 地下太平間」
export const themeTitle = (key) => (Object.hasOwn(THEMES, key) ? `${THEMES[key].floor} ${THEMES[key].name}` : '');
