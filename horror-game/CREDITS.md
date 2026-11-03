# 素材來源與授權

遊戲程式本身是原創的。以下是使用到的外部素材與它們的授權。CC0 素材不需要署名，這裡仍然列出來源以示感謝；CC BY 素材的署名同時顯示在遊戲內「操作說明 → 素材來源與授權」。

## 人物

| 檔案 | 來源 | 授權 | 修改 |
|---|---|---|---|
| `assets/ghost/ghost.glb` 與貼圖 | [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox) — `Medical_Female_01` 與 6 段動作 | MIT（`assets/ghost/LICENSE-Rocketbox.md`） | 轉成 glTF、精簡臉部表情與動作、重畫貼圖（見 `tools/ghost/`） |
| `assets/corpses/` 病床上的屍體 | Microsoft Rocketbox — `Sports_Male_01`、`Female_Adult_02`、`Medical_Male_04` | MIT（`assets/corpses/LICENSE-Rocketbox.md`） | 擺成各種躺姿、套用臉部表情後烘成靜態網格並簡化面數；貼圖重畫成屍體、加上傷口與血跡（見 `tools/corpse/`） |
| `assets/players/` 多人模式的其他玩家 | Microsoft Rocketbox — `Male_Adult_18`、`Female_Adult_08` 與男女各 4 段動作（緊張待機、一般待機、走、跑） | MIT（`assets/players/LICENSE-Rocketbox.md`） | 轉成 glTF 並壓縮頂點與動作資料；合成蹲姿、蹲著走與倒地動作；貼圖縮小並加上上衣染色遮罩（見 `tools/players/`） |

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
| `door_creak`、`door_slam`、`locker`、`scream0`、`scream1`、`pills`、`squeak`、`bang`、`metal_reverb`、`phone` | Sound effects from the Berklee College of Music sample library, OLPC Sound Library（<http://wiki.laptop.org/go/Sound_samples>），經由 [Tonejs/audio](https://github.com/Tonejs/audio) | **[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)**（已修改：裁切、調整音量、淡出） |
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

哼歌（照〈搖籃曲〉旋律即時合成的女聲哼唱）、低語、呼吸、追逐鼓點、雨中的風聲、收音機雜訊等其餘聲音都是即時合成的；任何音檔載入失敗時也會自動改用合成版本。

## 配樂（`assets/music/`）

配樂是遊戲裡即時編排的（`src/music.js`），用的是真實樂器的單音錄音，經裁切、響度對齊與轉成單聲道 MP3（`tools/music/prepare.py`）。搖籃曲旋律是布拉姆斯〈搖籃曲〉（Johannes Brahms, Wiegenlied, Op. 49 No. 4，1868 年）——作品已屬公有領域；音符是照原曲旋律自行寫入程式的（沒有使用任何現代編曲或錄音），伴奏和聲、音樂盒與哼唱的處理都是遊戲自己的。

| 檔案 | 原始錄音 | 授權 |
|---|---|---|
| `pno*`、`pnof*`（直立鋼琴）、`vc*`、`vct*`（大提琴長音與顫弓）、`cb*`（低音提琴）、`vnt*`（小提琴顫弓）、`glk*`（鐘琴，當成音樂盒） | [VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE) — Versilian Studios（Sam Gossner、Simon Dalzell 錄音，Elan Hickler / Soundemote 剪輯；直立鋼琴由 Ivy Audio 的 Simon Dalzell 取樣） | CC0（`assets/music/LICENSE-VSCO.md`） |

## 字型（`assets/fonts/`）

紙條、遺物說明、牆上的血字與察覺提示用的毛筆字。三套都是 [SIL Open Font License 1.1](https://openfontlicense.org)，授權全文與版權聲明在 `assets/fonts/OFL.txt`（單一檔案版本放在 HTML 結尾的註解裡）。都沒有保留字型名稱（Reserved Font Name）。

| 檔案 | 字型 | 版權 | 修改 |
|---|---|---|---|
| `brush-boku.woff2` | [Yuji Boku](https://fonts.google.com/specimen/Yuji+Boku) | Copyright 2021 The Yuji Project Authors（<https://github.com/Kinutafontfactory/Yuji>） | 只留下遊戲用到的字（約 475 字）、去掉 hinting，轉成 WOFF2（`tools/fonts/subset.py`） |
| `brush-msz.woff2` | [Ma Shan Zheng](https://fonts.google.com/specimen/Ma+Shan+Zheng) | Copyright 2018 The MaShanZheng Project Authors（<https://github.com/googlefonts/mashanzheng>） | 只留下 Yuji Boku 沒有的字與數字（22 字），同上 |
| `brush-wk.woff2` | [LXGW WenKai TC](https://fonts.google.com/specimen/LXGW+WenKai+TC) Bold | Copyright 2024 The LXGW WenKai Project Authors（<https://github.com/lxgw/LxgwWenkaiTC>） | 只留下前兩套都沒有的繁體字（9 字），同上 |

紙張、血跡、手印、指紋都是程式即時畫的（`src/paper.js`），沒有使用任何圖片素材。

## 程式庫

| 名稱 | 授權 |
|---|---|
| [three.js](https://threejs.org/) | MIT |
| [PeerJS](https://peerjs.com/)（多人連線，WebRTC 點對點） | MIT |
| [meshoptimizer](https://github.com/zeux/meshoptimizer)（遠處模型簡化） | MIT |
