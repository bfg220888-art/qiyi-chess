# 素材來源與授權

遊戲程式本身是原創的。以下是使用到的外部素材與它們的授權。CC0 素材不需要署名，這裡仍然列出來源以示感謝；CC BY 素材的署名同時顯示在遊戲內「操作說明 → 素材來源與授權」。

## 人物

| 檔案 | 來源 | 授權 | 修改 |
|---|---|---|---|
| `assets/ghost/ghost.glb` 與貼圖 | [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox) — `Medical_Female_01` 與 6 段動作 | MIT（`assets/ghost/LICENSE-Rocketbox.md`） | 轉成 glTF、精簡臉部表情與動作、重畫貼圖（見 `tools/ghost/`） |

## 照片貼圖（`assets/tex/`）

全部是 CC0（公眾領域）。遊戲執行時會再疊上程序生成的髒污、水漬與黴菌。

| 檔案 | 原始素材 | 經由 |
|---|---|---|
| `paint_*` | Poly Haven — [Peeling Painted Wall](https://polyhaven.com/a/peeling_painted_wall) | [je55pr/zombonz](https://github.com/je55pr/zombonz)（調色、縮成 1K WebP） |
| `tiles_*` | Poly Haven — [Dirty Tiles](https://polyhaven.com/a/dirty_tiles) | je55pr/zombonz |
| `lino_*` | Poly Haven — [Old Linoleum Flooring 01](https://polyhaven.com/a/old_linoleum_flooring_01) | je55pr/zombonz |
| `metal_*` | Poly Haven — Rusty Metal Sheet | je55pr/zombonz |
| `wood_*` | Poly Haven — [Wood Floor Worn](https://polyhaven.com/a/wood_floor_worn) | [npmiaman/game-forge](https://github.com/npmiaman/game-forge)（縮成 512 px） |
| `fabric_c` | ambientCG — Fabric066 | [PhotonPower/Gothar7](https://github.com/PhotonPower/Gothar7) |
| `leak_*`、`smear_o` | ambientCG — Leaking006、Smear005（牆面水痕與抹痕貼花，不透明度經過加強） | je55pr/zombonz |

## 音效（`assets/sfx/`）

全部轉成單聲道 MP3，並經過裁切、正規化音量與淡出（`tools/sfx/prepare.py`）。

| 檔案 | 原始錄音 | 授權 |
|---|---|---|
| `door_creak`、`door_slam`、`locker`、`scream0`、`scream1`、`pills`、`squeak`、`bang`、`metal_reverb`、`phone` | Sound effects from the Berklee College of Music sample library, OLPC Sound Library（<http://wiki.laptop.org/go/Sound_samples>），經由 [Tonejs/audio](https://github.com/Tonejs/audio) | **CC BY 3.0**（已修改：裁切、調整音量、淡出） |
| `step0`–`step7` | Nox_Sound — [Freesound #558472](https://freesound.org/s/558472/)，經由 AnthonE/Gates | CC0 |
| `door_open*`、`door_close*`、`creak*`、`latch`、`click` | [Kenney](https://kenney.nl) — RPG Audio | CC0 |
| `metal0`–`metal4`、`glass_hit*` | Kenney — Impact Sounds | CC0 |
| `heart_lub`、`heart_dub` | Joseph SARDIN - BigSoundBank.com，經由 tomasmach/nuzky | CC0 |
| `shutter`、`paper0`、`paper1` | Joseph SARDIN - BigSoundBank.com，經由 JasperKallfelz/shortform-edit-kit | CC0 |
| `glass` | chewiesmissus — [Freesound #244238](https://freesound.org/s/244238/)，經由 godotengine/godot-demo-projects | CC0 |
| `rain`、`thunder_near`、`thunder_far` | speakwithanimals、loganzsound、Emulius（Freesound），經由 jeffdafoe/llm-memory-plugin-salem-1692 | CC0 |
| `woosh` | EcoDTR（Freesound），Sonic Pi 的 `ambi_dark_woosh` | CC0 |
| `buzz` | 日光燈嗡嗡聲 — [Freesound #777053](https://freesound.org/s/777053/)，經由 yerdaulet-damir/liminal | CC0 |
| `breath` | 呼吸聲 — [Freesound #574208](https://freesound.org/s/574208/)，經由 yerdaulet-damir/liminal | CC0 |

哼歌、低語、呼吸、追逐配樂、雨中的風聲、收音機雜訊、音樂盒等其餘聲音都是即時合成的；任何音檔載入失敗時也會自動改用合成版本。

## 程式庫

| 名稱 | 授權 |
|---|---|
| [three.js](https://threejs.org/) | MIT |
