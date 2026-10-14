# 屍體模型工具

`assets/corpses/` 是用 [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)（MIT）的三個人物做的：`Sports_Male_01`（m021）、`Female_Adult_02`（f002）、`Medical_Male_04`（m162）。平常不需要重跑。

## 流程

1. 取出原始檔（只抓需要的部分）：
   ```bash
   git clone --filter=blob:none --no-checkout https://github.com/microsoft/Microsoft-Rocketbox.git rocketbox
   cd rocketbox
   for a in Professions/Sports_Male_01 Adults/Female_Adult_02 Professions/Medical_Male_04; do
     n=$(basename $a)
     git checkout HEAD -- Assets/Avatars/$a/Export/${n}_facial.fbx Assets/Avatars/$a/Textures
   done
   ```
   把三個 `*_facial.fbx` 複製（或連結）成 `m021.fbx`、`f002.fbx`、`m162.fbx`，和 `bake.html`、`poses.js` 放在同一個本機伺服器能讀到的位置（`bake.html` 從 `/c/` 讀 FBX、從 `/three/` 讀 three.js、從 `/meshopt/` 讀 meshoptimizer）。

2. `bake.html`（在瀏覽器或無頭 Chromium 裡開）：
   - `?uvmap=1`：輸出每個材質的部位圖 `uv-*.png`、綁定姿勢的 3D 位置圖 `uvpos-*.png`、法線圖 `uvnrm-*.png`、骨頭位置 `bones-*.json`，給貼圖腳本定位傷口。
   - `?keep=0.65&export=1`：依 `poses.js` 把每個人物擺成指定的躺姿（骨頭方向用床的座標系描述）、套上臉部表情，烘成靜態網格、用 meshoptimizer 簡化，輸出 `corpses.glb`。`&tex=1&view=iso|top|close` 會順便輸出預覽圖。

3. 貼圖：
   ```bash
   python3 corpse_tex.py <rocketbox/Assets/Avatars> <放 uv-*.png 等檔的資料夾> <輸出資料夾>
   ```
   需要 numpy 與 Pillow。皮膚改成死白、背面有屍斑；用 3D 位置在手腕畫割痕、在脖子畫勒痕、在 m021 胸前畫 Y 字解剖切口與縫線、在 m162 肚子畫刺傷；衣服浸血。

姿勢與人物的對應寫在 `poses.js`（烘焙用）和 `src/corpse-poses.js`（遊戲用，含每個姿勢需要的床邊空間），兩邊要一致。重新烘焙後，把 `bake.html` 印出的每個網格 z 範圍更新到 `src/corpse-poses.js` 的 `CORPSE_EXTENT`（遊戲用它把屍體擺進床頭板與床尾板之間、對齊地上的血）。
