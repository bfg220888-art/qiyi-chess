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

export const QUALITY = {
  low:    { label: '低', maxDpr: 1,   scale: 0.8, tex: 512,  propTex: 256, shadow: 512,  bloom: false, msaa: 0, lights: 3, dust: false, aniso: 2 },
  medium: { label: '中', maxDpr: 1.5, scale: 1,   tex: 1024, propTex: 512, shadow: 1024, bloom: true,  msaa: 0, lights: 4, dust: true,  aniso: 4 },
  high:   { label: '高', maxDpr: 2,   scale: 1,   tex: 1024, propTex: 1024, shadow: 2048, bloom: true, msaa: 4, lights: 6, dust: true,  aniso: 8 },
};

export const DIFFICULTY = {
  easy: {
    label: '簡單', desc: '鬼魂較慢、資源較多，可以被抓到一次。',
    lives: 2, ghostSpeed: 0.85, sight: 0.8, hearing: 0.75, drain: 0.7, batteries: 8, film: 4, pills: 4, bottles: 6, grace: 75, startFilm: 3,
  },
  normal: {
    label: '普通', desc: '標準的恐怖體驗。',
    lives: 1, ghostSpeed: 1.0, sight: 1.0, hearing: 1.0, drain: 1.0, batteries: 6, film: 3, pills: 3, bottles: 5, grace: 50, startFilm: 2,
  },
  nightmare: {
    label: '惡夢', desc: '她更快、更敏銳。電池稀少，沒有地圖。',
    lives: 1, ghostSpeed: 1.15, sight: 1.25, hearing: 1.3, drain: 1.35, batteries: 4, film: 2, pills: 2, bottles: 4, grace: 30, startFilm: 1, noMap: true,
  },
};
