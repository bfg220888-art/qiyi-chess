// 屍體的躺姿。座標系＝病床：+X 橫跨床（仰躺時是身體左側），+Y 朝上，+Z 往床尾（頭在 -Z）。
// up：骨盆→頭的方向；front：胸口朝向。dirs：每根骨頭指向下一個關節的方向。
// head：臉的朝向與頭頂方向。curl：手指彎曲程度。morphs：臉部表情（0..1）。
const n = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const mirror = (dirs) => {
  const out = { ...dirs };
  for (const [k, v] of Object.entries(dirs)) if (k.startsWith('L_') && !(('R_' + k.slice(2)) in dirs)) out['R_' + k.slice(2)] = [-v[0], v[1], v[2]];
  return out;
};
const deadFace = { JawOpen: 0.75, EyeBlinkLeft: 0.35, EyeBlinkRight: 0.45, MouthFrownLeft: 0.4, MouthFrownRight: 0.4, BrowInnerUp: 0.3 };
const screamFace = { JawOpen: 1.0, MouthStretchLeft: 0.8, MouthStretchRight: 0.8, EyeWideLeft: 0.9, EyeWideRight: 0.9, BrowInnerUp: 0.8, MouthLowerDownLeft: 0.6, MouthLowerDownRight: 0.6 };

export const POSES = {
  // 仰躺，雙手放在身體兩側，頭歪向一邊，嘴巴張開
  supine: {
    up: n(0, 0, -1), front: n(0, 1, 0),
    dirs: mirror({
      Spine: n(0, 0.04, -1), Spine1: n(0, 0.06, -1), Spine2: n(0, 0.1, -1), Neck: n(0, 0.2, -1),
      L_UpperArm: n(0.28, -0.12, 1), L_Forearm: n(0.12, -0.05, 1), L_Hand: n(0.1, -0.2, 1),
      L_Thigh: n(0.09, 0, 1), L_Calf: n(0.04, 0, 1), L_Foot: n(0.45, 0.85, 0.25),
    }),
    head: { face: n(0.65, 0.76, 0), up: n(0, 0.05, -1) },
    curl: 0.35, morphs: deadFace,
  },
  // 仰躺，右手垂到床外，左膝立起
  dangle: {
    up: n(0, 0, -1), front: n(0, 1, 0),
    dirs: mirror({
      Spine: n(0, 0.04, -1), Spine1: n(-0.04, 0.05, -1), Spine2: n(-0.08, 0.08, -1), Neck: n(-0.1, 0.15, -1),
      L_UpperArm: n(0.35, -0.05, 1), L_Forearm: n(-0.3, 0.1, 1), L_Hand: n(-0.5, 0.0, 1),
      R_UpperArm: n(-1, -0.5, 0.15), R_Forearm: n(-0.12, -1, 0.1), R_Hand: n(0, -1, 0.1),
      L_Thigh: n(0.12, 0.75, 0.65), L_Calf: n(0.05, -0.75, 0.65), L_Foot: n(0.05, 0.3, 0.95),
      R_Thigh: n(-0.08, 0, 1), R_Calf: n(-0.04, 0, 1), R_Foot: n(-0.5, 0.8, 0.3),
    }),
    head: { face: n(-0.7, 0.71, 0.05), up: n(-0.1, 0.1, -1) },
    curl: 0.55, morphs: { ...deadFace, JawOpen: 0.95 },
  },
  // 側躺蜷縮（右側著床，臉朝 -X）
  curled: {
    up: n(0, 0, -1), front: n(-1, 0, 0),
    dirs: {
      Spine: n(-0.15, 0, -1), Spine1: n(-0.35, 0, -0.94), Spine2: n(-0.5, 0, -0.87), Neck: n(-0.6, -0.05, -0.8),
      L_UpperArm: n(-0.75, 0.15, 0.3), L_Forearm: n(0.1, -0.1, -1), L_Hand: n(0.2, -0.3, -0.9),
      R_UpperArm: n(-0.85, 0.08, -0.35), R_Forearm: n(-0.15, 0.12, -1), R_Hand: n(0.25, 0.15, -0.9),
      L_Thigh: n(-0.95, 0.08, -0.25), L_Calf: n(0.15, 0.02, 1), L_Foot: n(0.35, 0.0, 0.94),
      R_Thigh: n(-0.85, -0.05, -0.1), R_Calf: n(0.25, 0, 1), R_Foot: n(0.4, -0.1, 0.9),
    },
    head: { face: n(-0.8, -0.1, 0.55), up: n(-0.55, 0.1, -0.83) },
    curl: 0.9, morphs: { ...deadFace, JawOpen: 0.4, EyeBlinkLeft: 0.9, EyeBlinkRight: 0.9 },
  },
  // 趴著，一隻手伸向床頭外面
  prone: {
    up: n(0, 0, -1), front: n(0, -1, 0),
    dirs: {
      Spine: n(0, -0.02, -1), Spine1: n(0, -0.02, -1), Spine2: n(0, 0, -1), Neck: n(0, 0.05, -1),
      // 左手彎到臉旁邊（不伸過頭頂，才放得進有床頭板的病床）
      L_UpperArm: n(-0.85, -0.12, -0.5), L_Forearm: n(0.55, -0.12, -0.8), L_Hand: n(0.5, -0.4, -0.75),
      R_UpperArm: n(0.3, -0.1, 1), R_Forearm: n(0.05, 0.1, 1), R_Hand: n(0, 0.2, 1),
      L_Thigh: n(-0.12, 0, 1), L_Calf: n(-0.05, 0, 1), L_Foot: n(-0.15, -0.75, 0.65),
      R_Thigh: n(0.25, 0.05, 0.95), R_Calf: n(0.1, 0.6, 0.8), R_Foot: n(0.1, 0.3, 0.95),
    },
    head: { face: n(-0.85, -0.5, 0.1), up: n(0, 0, -1) },
    curl: 0.6, morphs: deadFace,
  },
  // 屍僵：背弓起、頭往後仰、雙手像爪子一樣舉起
  rigor: {
    up: n(0, 0, -1), front: n(0, 1, 0),
    dirs: mirror({
      Spine: n(0, 0.15, -1), Spine1: n(0, 0.2, -1), Spine2: n(0, 0.05, -1), Neck: n(0, -0.25, -1),
      L_UpperArm: n(0.45, 0.6, 0.35), L_Forearm: n(0.05, 0.6, -0.8), L_Hand: n(-0.1, 0.2, -1),
      L_Thigh: n(0.15, 0.35, 0.95), L_Calf: n(0.05, -0.45, 0.9), L_Foot: n(0.1, 0.0, 1),
    }),
    head: { face: n(0, 0.55, -0.83), up: n(0, -0.83, -0.55) },
    curl: 1.0, morphs: screamFace,
  },
  // 從床邊滑落一半：腿還在床上，上半身倒掛到地上
  halfoff: {
    up: n(-0.78, -0.52, 0.15), front: n(-0.4, 0.65, 0.1),
    dirs: mirror({
      Spine: n(-0.72, -0.62, 0.12), Spine1: n(-0.82, -0.52, 0.1), Spine2: n(-0.9, -0.38, 0.08), Neck: n(-0.95, -0.2, 0.05),
      L_UpperArm: n(-0.55, -0.6, 0.55), L_Forearm: n(-0.55, -0.05, 0.83), L_Hand: n(-0.45, -0.05, 0.9),
      R_UpperArm: n(-0.6, -0.6, -0.5), R_Forearm: n(-0.75, -0.05, -0.65), R_Hand: n(-0.7, -0.05, -0.7),
      L_Thigh: n(0.92, 0.2, 0.3), L_Calf: n(0.25, -0.1, 0.96), L_Foot: n(0.3, 0.9, 0.2),
      R_Thigh: n(0.85, 0.1, -0.15), R_Calf: n(0.4, -0.2, 0.9), R_Foot: n(0.2, 0.9, 0.3),
    }),
    head: { face: n(0.15, 0.75, 0.62), up: n(-0.98, 0.1, 0.1) },
    curl: 0.3, morphs: { ...screamFace, JawOpen: 0.85, EyeWideLeft: 0.6, EyeWideRight: 0.6 },
    rest: 'legs',
  },
  // 靠著床頭坐，頭垂到胸前
  slumped: {
    up: n(0, 0.9, 0.35), front: n(0, -0.35, 0.94),
    dirs: mirror({
      Spine: n(0, 0.95, 0.3), Spine1: n(0, 0.9, 0.42), Spine2: n(0.05, 0.8, 0.6), Neck: n(0.1, 0.4, 0.9),
      L_UpperArm: n(0.25, -0.9, 0.3), L_Forearm: n(0.15, -0.55, 0.8), L_Hand: n(0.25, -0.5, 0.85),
      L_Thigh: n(0.1, 0, 1), L_Calf: n(0.05, 0, 1), L_Foot: n(0.4, 0.85, 0.3),
    }),
    head: { face: n(0.3, -0.75, 0.6), up: n(0.15, 0.6, 0.78) },
    curl: 0.4, morphs: { ...deadFace, JawOpen: 0.6 },
    rest: 'pelvis',
  },
};

// 每個人物要烘幾種姿勢（同一個姿勢可以給不同人物）
export const AVATARS = [
  { id: 'm021', poses: ['supine', 'dangle', 'rigor', 'halfoff'] },
  { id: 'f002', poses: ['curled', 'prone', 'supine', 'slumped'] },
  { id: 'm162', poses: ['dangle', 'prone', 'supine'] },
];
