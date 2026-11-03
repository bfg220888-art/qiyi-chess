// 世界尺寸（公尺）
export const CELL = 3;          // 一格地圖的邊長
export const WALL_H = 3.0;      // 天花板高度
export const WALL_T = 0.2;      // 牆厚
export const DOOR_W = 1.2;
export const DOOR_H = 2.2;
export const GATE_W = 2.4;
export const GATE_H = 2.5;
export const EYE_H = 1.62;
export const CROUCH_H = 1.02;
export const PLAYER_R = 0.3;
export const GHOST_R = 0.25;
export const NAV_RES = 0.5;     // 鬼魂尋路網格解析度

// 中畫質最高 1.25 倍像素（高 DPI 筆電不會一次畫兩倍多的像素而發燙），鋸齒交給 FXAA 柔化
export const QUALITY = {
  low:    { label: '低', maxDpr: 1,   scale: 0.8, tex: 512,  propTex: 256, shadow: 512,  bloom: false, msaa: 0, lights: 3, dust: false, aniso: 4 },
  medium: { label: '中', maxDpr: 1.25, scale: 1,   tex: 1024, propTex: 512, shadow: 1024, bloom: true,  msaa: 0, lights: 4, dust: true,  aniso: 8 },
  high:   { label: '高', maxDpr: 2,   scale: 1,   tex: 1024, propTex: 1024, shadow: 2048, bloom: true, msaa: 4, lights: 6, dust: true,  aniso: 8 },
};

// 多人連線的樓層數依難度：簡單 1 層、普通 2 層、惡夢 3 層（單人固定 1 層）
export const MP_FLOORS = { easy: 1, normal: 2, nightmare: 3 };

// 平衡調整（見 README「難度與平衡」）：
//   downed  多人倒地等人來扶的秒數
//   grace   開局到她第一次出現的秒數（多層樓時每多一層加 25%，見 game.js）
//   film    散落的底片（上鎖的房間另外有一捲三張的底片，所以普通 / 惡夢各少放一捲）
//   sight   視覺距離倍率（基準 12 公尺）
//   notice  察覺累積速度：站著、不開手電筒、不在燈下、距離 7 公尺時每秒累積多少（1 = 滿，滿了才追）
//   giveUp  追逐中看不到你幾秒就跟丟（改成在附近搜索）
//   search  跟丟之後在附近搜索幾秒就放棄、回去遊蕩
//   COOP_ITEMS 多人時電池、鎮定劑、底片、玻璃瓶每多一個人多放幾成（每個人的手電筒各自耗電，道具卻只有一份）
export const COOP_ITEMS = { batteries: 0.4, pills: 0.35, film: 0.25, bottles: 0.25 };
export const DIFFICULTY = {
  easy: {
    label: '簡單', desc: '鬼魂較慢、資源較多，可以被抓到一次。',
    lives: 2, ghostSpeed: 0.8, sight: 0.7, notice: 0.72, giveUp: 2.4, search: 11, hearing: 0.75, drain: 0.7, batteries: 8, film: 4, pills: 4, bottles: 6, grace: 90, startFilm: 3, downed: 40,
    // 地圖：小一點、走廊單純（少死路、少殘缺棋盤）、每層只鎖一間
    map: { size: -1, locks: 1, simple: 1 },
  },
  normal: {
    label: '普通', desc: '標準的恐怖體驗。',
    lives: 1, ghostSpeed: 1.0, sight: 0.88, notice: 1.1, giveUp: 2.8, search: 14, hearing: 1.0, drain: 1.0, batteries: 6, film: 2, pills: 3, bottles: 5, grace: 50, startFilm: 2, downed: 30,
    map: { size: 0, locks: 0, simple: 0 },
  },
  nightmare: {
    label: '惡夢', desc: '她更快、更敏銳。電池稀少，沒有地圖。',
    lives: 1, ghostSpeed: 1.15, sight: 1.25, notice: 2.0, giveUp: 3.2, search: 16, hearing: 1.3, drain: 1.35, batteries: 4, film: 1, pills: 2, bottles: 4, grace: 30, startFilm: 1, downed: 25, noMap: true,
    // 地圖：大一點、走廊複雜（多死路、拆掉的棋盤格、魚骨形）、每層鎖兩間
    map: { size: 1, locks: 2, simple: -1 },
  },
};
