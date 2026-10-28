# 玩家模型轉檔工具

多人模式裡其他玩家的第三人稱模型（`assets/players/`）是從 [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)（MIT 授權）的兩個便服人物轉出來的：

| 人物 | Rocketbox | 編號 | 遊戲裡的玩家 |
| --- | --- | --- | --- |
| 男：灰色連帽上衣、黑長褲 | `Adults/Male_Adult_18` | m023 | 0 號（紅）、2 號（綠） |
| 女：灰色 T 恤、牛仔褲 | `Adults/Female_Adult_08` | f008 | 1 號（藍）、3 號（黃） |

上衣在貼圖裡是灰色的，遊戲載入時依玩家編號用遮罩（`*_mask.png`）把它染成紅、藍、綠、黃。平常不需要重跑，這裡只是留下可重現的做法。

## 1. 取得原始檔

```bash
git clone --filter=blob:none --no-checkout https://github.com/microsoft/Microsoft-Rocketbox.git rocketbox
cd rocketbox
# 只抓需要的檔案（整個庫有好幾 GB）
git checkout HEAD -- Assets/Avatars/Adults/Male_Adult_18/Export/Male_Adult_18.fbx Assets/Avatars/Adults/Male_Adult_18/Textures \
  Assets/Avatars/Adults/Female_Adult_08/Export/Female_Adult_08.fbx Assets/Avatars/Adults/Female_Adult_08/Textures
for g in m f; do
  git checkout HEAD -- Assets/Animations/all_animations_max_motextr_xy/${g}_walk_neutral_01.max.fbx \
    Assets/Animations/all_animations_max_motextr_xy/${g}_run_neutral_01.max.fbx \
    Assets/Animations/all_animations_max_motextr_static/${g}_idle_nervous_01.max.fbx \
    Assets/Animations/all_animations_max_motextr_static/${g}_idle_neutral_01.max.fbx
done
```

## 2. FBX → GLB

```bash
node tools/players/run-convert.mjs <rocketbox 資料夾>     # 輸出 assets/players/player.glb
```

`run-convert.mjs` 在無頭 Chromium 裡開 `convert.html`（three.js 的 FBXLoader → GLTFExporter），再用 `compact-glb.mjs` 壓小：

- 用沒有臉部表情的 FBX（遊戲裡看不到表情），UV 上下翻轉成 glTF 慣例（貼圖載入時 `flipY = false`），合併重複頂點；超過 9000 個三角形才用 meshoptimizer 簡化（目前男 6.4k、女 8.3k，不需要）。
- 頂點資料用 `KHR_mesh_quantization` 壓縮（法線 int8、UV uint16、骨頭權重 uint8）；動作的旋轉存 int16，各軌道共用時間陣列。GLTFLoader 可以直接讀，不需要解碼器。
- 兩副骨架的骨頭加上 `M_` / `F_` 前綴，動作名稱是 `M_walk`、`F_run`……
- 動作：`idle`（緊張的待機，取前 10 秒、結尾漸漸接回開頭）、`walk`、`run`（原始資料會往前移動，去掉水平位移變成原地動作）。
- 合成的動作：
  - `crouch`、`crouchwalk`：Rocketbox 沒有蹲著走，所以自己擺一個蹲姿（膝蓋彎、上身前傾），把「蹲姿相對站姿」的旋轉差疊到待機與走路的每一格，再把身體降到最低的那隻腳剛好踩地。
  - `dead`：倒地。0.4 秒跪下，再往前撲倒、側臉趴在地上（1.2 秒，播一次後停住）。
- 每段移動動作的原始速度與步伐相位存在人物節點的 `userData.gait`（例：男 walk 1.0 m/s、run 2.7 m/s），遊戲用它推進動作，腳才不會在地上滑。

## 3. 貼圖

```bash
python3 tools/players/player_tex.py <rocketbox>/Assets/Avatars/Adults assets/players [預覽資料夾]
```

需要 `numpy` 與 `Pillow`。輸出身體 1024 JPG、頭 512 JPG、女生髮絲 512 WebP（含透明度），以及上衣遮罩 `*_mask.png`（256 灰階：彩度低的灰色布料，排除褲子、手、鞋、手錶）。

## 4. 檢查

```bash
node tools/players/preview.mjs        # 截圖存到 tests/output/players/
```

`preview.html` 用 `src/player-model.js` 擺出四個玩家（待機、走、跑、蹲著走；蹲、倒地；手電筒開燈），截圖檢查方向、貼圖、動作與手上的手電筒。
