# 女鬼模型轉檔工具

`assets/ghost/` 裡的模型與貼圖是從 [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)（MIT 授權）的 `Medical_Female_01` 轉出來的。平常不需要重跑，這裡只是留下可重現的做法。

## 1. 取得原始檔

```bash
git clone --filter=blob:none --no-checkout https://github.com/microsoft/Microsoft-Rocketbox.git rocketbox
cd rocketbox
# 只抓需要的檔案（整個庫有好幾 GB）
git checkout HEAD -- Assets/Avatars/Professions/Medical_Female_01
for f in f_walk_injured f_walk_bruised f_walk_drunk f_run_injured; do
  git checkout HEAD -- Assets/Animations/all_animations_max_motextr_xy/$f.max.fbx; done
for f in f_idle_look_around_01 f_idle_roll_head_01; do
  git checkout HEAD -- Assets/Animations/all_animations_max_motextr_static/$f.max.fbx; done
```

## 2. FBX → GLB

`convert.html` 在無頭 Chromium 裡用 three.js 的 FBXLoader 讀入有臉部表情的 FBX，做這些事再用 GLTFExporter 匯出：

- 只保留恐怖表情需要的 16 個臉部混合形狀（張嘴、瞪眼、皺眉……），並重新命名。
- UV 上下翻轉成 glTF 慣例，合併重複頂點。
- 只留下走路、跑、張望等幾段動作，太長的重新取樣成 15 fps，把檔案壓在 2 MB 以內。

把 `Medical_Female_01/Export/Medical_Female_01_facial.fbx` 和上面六個動作 `.max.fbx` 複製到同一個資料夾，然後：

```bash
node tools/ghost/run-convert.mjs <那個資料夾>     # 輸出到 assets/ghost/ghost.glb
```

## 3. 貼圖

```bash
python3 tools/ghost/horror_tex.py <Medical_Female_01/Textures> <輸出資料夾>
```

需要 `numpy` 與 `Pillow`。腳本把皮膚改成死白發青、加深眼窩、讓眼睛混濁、加上血管與血淚，制服泛黃並沾上血跡，輸出遊戲用的 JPG/PNG。
