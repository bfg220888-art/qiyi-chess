// 遊戲裡的文件（「紙條」）：內容、類型、故事線，以及每一局要放哪幾份。
// 這個檔案只有資料與純函式（不碰 DOM），level.js（放置）、ui.js（顯示）、paper.js（畫紙）、
// tools/fonts/charset.mjs（字型子集）與測試都共用它。
//
// 時間軸（民國 88 年＝1999 年）：
//   5～7 月   老陳三次申請更換備用發電機的保險絲，院長都駁回
//   8/13 03:12 林○蓮（七樓護理師）在本院產下一女；21:52 停電、發電機沒啟動、保溫箱停了 43 分鐘；
//              22:35 復電（全部的燈都亮了）；23:40 宣告死亡
//   8/14      院長下令統一口徑、不告知產婦；之後她每晚「巡房」找孩子，被當成精神病人關進 707
//   8/26      第 9 次電療；8/27 04:10 她死在 707，走廊上的哼歌聲沒有停
//   8/28～30  方醫師、吳護理師陸續失蹤；8/30 夜再度停電，老陳把保險絲藏起來，留守的人被關在裡面
//   8/31      封院；9/2 見報
//   2019/3/16 探險直播主阿哲進入後失聯；之後才是玩家
import { RNG } from './rng.js';

// 故事線（檔案清單照這個順序分組）
export const DOC_LINES = [
  { key: 'main', name: '主線　七樓的病人' },
  { key: 'night', name: '那一夜　嬰兒室' },
  { key: 'guard', name: '巡邏　警衛阿坤' },
  { key: 'cover', name: '封存　院長室' },
  { key: 'intruder', name: '二十年後　闖入者' },
];

// 每一種文件類型：body = 內文預設的字（pen 手寫 / print 鉛字 / sys 系統黑體）、form = 表頭與欄位名稱的字、
// name = 類型名稱（README 與測試用）。每一份文件各用一種類型，沒有兩份長得一樣。
export const DOC_TYPES = {
  handover: { name: '護理交班單', body: 'pen', form: 'print' },
  memo: { name: '手寫便條', body: 'pen', form: 'print' },
  calendar: { name: '日曆紙背面', body: 'pen', form: 'print' },
  ect: { name: '治療紀錄單', body: 'pen', form: 'print' },
  chart: { name: '病歷首頁', body: 'pen', form: 'print' },
  crayon: { name: '蠟筆畫', body: 'pen', form: 'pen' },
  transcript: { name: '錄音逐字稿', body: 'print', form: 'print' },
  nursing: { name: '護理紀錄單', body: 'pen', form: 'print' },
  cribcard: { name: '嬰兒床頭卡', body: 'pen', form: 'print' },
  letter: { name: '信箋', body: 'pen', form: 'print' },
  patrol: { name: '巡邏紀錄表', body: 'pen', form: 'print' },
  medbag: { name: '藥袋', body: 'pen', form: 'print' },
  photoback: { name: '相片背面', body: 'pen', form: 'print' },
  official: { name: '內部公文', body: 'print', form: 'print' },
  incident: { name: '事故報告（複寫聯）', body: 'pen', form: 'print' },
  workorder: { name: '維修申請單', body: 'pen', form: 'print' },
  clipping: { name: '剪報', body: 'print', form: 'print' },
  flyer: { name: '尋人啟事（噴墨列印）', body: 'sys', form: 'sys' },
  notebook: { name: '筆記本內頁', body: 'pen', form: 'print' },
  receipt: { name: '感熱紙收據', body: 'sys', form: 'sys' },
  relic: { name: '遺物說明', body: 'brush', form: 'brush' },
};

// 內文的行內標記：
//   ~劃掉的字~   {另一枝筆 / 手寫填進去的字}   [[用血寫的字]]   <<用紅筆圈起來的字>>   [x] [ ] 勾選框
// 區塊（每一項是 [種類, ...參數]）見 docTree()。
export const DOCS = [
  // ---------------------------------------------------------------- 主線
  {
    id: 'handover', type: 'handover', line: 'main', place: 'lobby', title: '護理站交班紀錄',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　護理部', title: '病房交班紀錄單' }],
      ['kv', [['單位', '7F', 22], ['日期', '88 年 8 月 30 日', 44], ['班別', '[ ]白 [ ]小夜 [x]大夜', 34]]],
      ['tbl', { cls: 'c2', head: ['床號', '交班事項'], rows: [
        ['全區', '20:47 又停電了。備用發電機需要三個保險絲才能啟動，但維修的老陳把它們拆下來，說要「藏好」，怎麼問都不說藏在哪。'],
        ['大門', '電子鎖沒電就打不開。警衛試過了。<<我們被困在裡面了。>>'],
        ['705', '8/29 已轉院，空床。全院病人都轉走了。'],
        ['707', '又在哼歌。~病人情緒不穩~ 那張床從 27 號就空了。院長說不要理她。'],
        ['人力', '小慧昨晚沒交班就不見了。今晚只剩我、警衛阿坤、老陳，還有院長。不要一個人走到七樓底。'],
      ] }],
      ['sig', [['交班者', '周○芬'], ['接班者', '']]],
      ['hand', '沒有人來接班。', { cls: 'late' }],
      ['blood', '出不去'],
    ],
  },
  {
    id: 'memo', type: 'memo', line: 'main', place: 'nurse', title: '維修工老陳的紙條',
    blocks: [
      ['hand', '8/30　夜　　陳', { cls: 'r' }],
      ['p', '保險絲我拆了，分開藏在三個房間裡。'],
      ['p', '不是要害大家。發電機一轉、燈全部亮起來，「她」就會以為又是那一晚。13 號燈亮的時候她站在嬰兒室門口，看到了什麼，你們都知道。'],
      ['p', '暗著的時候她只是在找。'],
      ['p', '~這樣大家比較~ 後來才想到大門的電子鎖沒電不會開。對不起。'],
      ['p', '要出去的人：發電機房在這層樓最裡面。<<三個保險絲都插回配電箱>>，大門的電子鎖就會重新通電打開。'],
      ['p', '燈一亮就跑。不要等我。'],
      ['print', '永固電機行　敬贈', { cls: 'pad-foot' }],
    ],
  },
  {
    id: 'calendar', type: 'calendar', line: 'main', place: 'corridor', title: '警衛的筆記',
    blocks: [
      ['ghost', { day: '28', month: '8', week: '星期六', year: '中華民國八十八年' }],
      ['hand', '給接班的（如果還有人來）：', { cls: 'lead' }],
      ['list', [
        '聽到哼歌聲，代表她在附近閒晃。',
        '哼歌聲突然停了——<<快跑>>。',
        '跑不掉就躲進鐵櫃，千萬別讓她看到你躲進去。',
        '手電筒的光會讓她更容易發現你，不必要時關掉。',
        '不要在黑暗裡待太久，你會開始看見不存在的東西。',
      ]],
      ['hand', '8/29　警衛室　阿坤', { cls: 'r' }],
    ],
  },
  {
    id: 'ect', type: 'ect', line: 'main', place: 'office', title: '主治醫師的治療紀錄',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　精神科', title: '電痙攣治療紀錄', no: '表 P-07' }],
      ['kv', [['病歷號', '0713', 30], ['姓名', '林○蓮', 34], ['床號', '707', 36], ['日期', '88.8.26', 30], ['次數', '第 9 次（本週第 4 次）', 70], ['麻醉', '[ ]有 [x]無', 40], ['約束', '[x]四肢 [x]胸帶', 60]]],
      ['h', '治療後觀察'],
      ['p', '電擊之後，患者對強光產生劇烈反應。紀錄用相機的閃光燈一閃，她會僵住好幾秒，像是被釘在原地。'],
      ['p', '夜班護理師說半夜看見她站在走廊盡頭，可是那時候她明明被綁在床上。束帶完好。'],
      ['p', '我開始不確定我們在治療的是什麼。'],
      ['sig', [['主治醫師', '']]],
      ['stamp', { text: '主治醫師\n方○遠', shape: 'rect', color: 'red', rot: -4, at: 'sig' }],
      ['h', '院長批示'],
      ['hand', '繼續。讓她安靜到稽查結束。　何', { ink: 'red' }],
    ],
  },
  {
    id: 'chart', type: 'chart', line: 'main', place: 'story', title: '病歷　編號 0713',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院', title: '病　歷　首　頁', no: '病歷號 0713' }],
      ['label', ['0713', '林○蓮　女　27 歲', '7F-707']],
      ['kv', [['姓名', '林○蓮', 40], ['性別', '女', 24], ['年齡', '27', 36], ['職業', '本院七樓護理師', 100], ['入院日期', '88 年 8 月 13 日', 100], ['入院原因', '~待產~　產後精神失常', 100], ['病房', '~產科 502~　707', 100]]],
      ['h', '病程摘要'],
      ['p', '患者堅稱她的孩子還在醫院裡，每晚穿著護理服在走廊上「巡房」、尋找。拒絕進食。整夜哼著同一首搖籃曲。'],
      ['h', '備註'],
      ['p', '<<嬰兒於入院當天死亡。患者未被告知。>>'],
      ['kv', [['離院', '[ ]出院 [ ]轉院 [x]死亡', 56], ['時間', '8/27 04:10', 44]]],
      ['stamp', { text: '死　亡', shape: 'rect', color: 'red', rot: -9, at: 'mid' }],
      ['hand', '27 號之後，707 每天晚上還是有人巡房。', { cls: 'late' }],
    ],
  },
  {
    id: 'crayon', type: 'crayon', line: 'main', place: 'story', title: '蠟筆畫',
    blocks: [
      ['draw'],
      ['hand', '媽媽一直在找我。\n我在這裡呀。\n為什麼她看不到我？', { cls: 'kid' }],
      ['hand', '412 床小安畫的。她說字是「樓上的小妹妹」教她寫的。　兒科 8/29', { cls: 'adult' }],
    ],
  },
  {
    id: 'transcript', type: 'transcript', line: 'main', place: 'gen', title: '最後的錄音逐字稿',
    blocks: [
      ['hd', { org: '證物逐字稿（現場留存聯）', title: '錄音帶譯文', no: '證物 88-0831-07' }],
      ['kv', [['發現地點', '發電機房配電箱下方', 100], ['錄音時間', '推定 8 月 31 日凌晨', 100]]],
      ['tbl', { cls: 'tc', rows: [
        ['00:00', '（雜音。雨聲。有人在喘氣。）'],
        ['00:09', '女聲：……如果有人找到這個……'],
        ['00:21', '女聲：她不是要傷害我們。她只是在找她的孩子。可是只要被她抓到的人，就再也沒有出來過。'],
        ['00:40', '男聲（遠處）：護理長，她上來了。'],
        ['00:44', '女聲：發電機一啟動，她會發狂。全部的燈都亮的那一刻，往大門跑，不要回頭。'],
        ['00:58', '女聲：孩子的東西我藏起來了。本來想放回她的小床上，也許這樣她就——'],
        ['01:06', '（哼歌聲，由遠而近。）'],
        ['01:15', '女聲：不要——'],
        ['01:16', '（錄音中斷）'],
      ] }],
      ['blood', '不要回頭'],
    ],
  },
  // ---------------------------------------------------------------- 那一夜
  {
    id: 'nursing', type: 'nursing', line: 'night', place: 'nurse', title: '嬰兒室護理紀錄',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院', title: '護理紀錄單', no: '嬰兒室' }],
      ['kv', [['姓名', '林○蓮之女', 56], ['日期', '88.8.13', 44]]],
      ['tbl', { cls: 'c3', head: ['時間', '紀錄', '簽名'], rows: [
        ['03:12', '產房娩出，女，2950 g，哭聲宏亮。', '周'],
        ['03:40', '呼吸稍快，入保溫箱給氧觀察。母親抱過了，母女均安。', '周'],
        ['16:00', '呼吸平順，活動力好。預計明早移出保溫箱。', '周'],
        ['21:52', '全院停電。備用發電機沒有啟動。保溫箱、氧氣、監視器全部停了。', '周'],
        ['21:55', '改手動給氧。打給工務組，老陳說保險絲燒了，他去別的配電箱拆。', '周'],
        ['22:20', '膚色發紺。持續急救。', '周'],
        ['22:35', '復電，全部的燈都亮了。蓮站在門口，她自己從產科走上來的。她都看到了。', '周'],
        ['23:40', '急救無效。', '周'],
        ['23:55', '院長到。要我把這一張重寫。', ''],
      ] }],
      ['hand', '這張是原本的。我沒有交出去。　周○芬', { cls: 'late' }],
    ],
  },
  {
    id: 'cribcard', type: 'cribcard', line: 'night', place: 'story', title: '嬰兒床頭卡',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　嬰兒室', title: '女　GIRL' }],
      ['kv', [['母親姓名', '林○蓮', 100], ['出生', '88 年 8 月 13 日 03 時 12 分', 100], ['體重', '2950 公克', 50], ['身長', '49 公分', 50], ['床號', '嬰 7', 40], ['餵食', '[x]母乳 [ ]配方', 60]]],
      ['hand', '小名：藕藕。大名等出院再想。　媽媽', { cls: 'mom' }],
      ['hand', '~本卡依院長指示銷毀~', { cls: 'late' }],
    ],
  },
  {
    id: 'letter', type: 'letter', line: 'night', place: 'nurse', title: '沒有寄出的信',
    blocks: [
      ['print', '聖羅莎紀念醫院　用箋', { cls: 'lh' }],
      ['p', '蓮：'],
      ['p', '這封信妳已經收不到了，可是我還是要寫。'],
      ['p', '那天晚上不是妳的錯，寶寶的心臟也沒有問題。是停電。發電機的保險絲老陳報修了三次，院長都沒有批。保溫箱停了四十三分鐘。'],
      ['p', '他們要我們說是先天的，還說不能告訴妳。後來妳一直找，他們就說妳瘋了，把妳關進 707。我是妳的護理長，我什麼都沒有說。'],
      ['p', '妳走了以後，走廊上每天晚上還是有人哼那首歌。方醫師不見了，小慧也是。我知道是妳，也知道妳要找的不是我們。'],
      ['p', '寶寶的東西院長叫我丟掉，我沒有丟：一隻毛線鞋、手環、還有那天早上在護理站拍的照片。我分開藏在醫院裡，怕被他們一次找到。'],
      ['p', '等稽查的人來過，我會把三樣東西都<<放回她的小床上>>，點一支蠟燭。妳抱不到她，至少讓妳找得到她。'],
      ['p', '對不起。'],
      ['hand', '芬　　8 月 29 日夜', { cls: 'r' }],
    ],
  },
  // ---------------------------------------------------------------- 警衛
  {
    id: 'patrol', type: 'patrol', line: 'guard', place: 'corridor', title: '夜間巡邏紀錄表',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　總務組', title: '夜間巡邏紀錄表', no: '88 年 8 月' }],
      ['tbl', { cls: 'c4', head: ['日期', '時間', '地點', '狀況'], rows: [
        ['8/28', '23:00', '7F 走廊', '707 有人哼歌。開門看，空床。'],
        ['8/28', '02:10', '精神科', '方醫師的燈亮著，人不在。咖啡還是熱的。'],
        ['8/29', '01:30', '7F 護理站', '吳護理師不在位子上，電話沒掛好。'],
        ['8/29', '03:00', '藥局', '門鎖著。<<要刷卡的門她進不去>>，還鎖著的時候裡面可以待。卡片放在別的房間。'],
        ['8/30', '21:00', '全院', '停電。老陳說保險絲他收走了。'],
        ['8/30', '22:40', '院長室', '有手電筒的光。院長在撕文件，一張一張撕。'],
        ['8/30', '23:30', '院長室', '門開著，沒人。滿地碎紙，手電筒滾在地上還亮著。'],
        ['8/30', '00:15', '7F', '哼歌停了'],
      ] }],
      ['sig', [['巡邏人員', '許○坤'], ['組長', '']]],
    ],
  },
  {
    id: 'medbag', type: 'medbag', line: 'guard', place: 'locker', title: '藥袋上的字',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　藥局', title: '藥　袋' }],
      ['kv', [['姓名', '許○坤', 60], ['日期', '8/29', 40], ['藥名', '鎮定劑　5 毫克', 100], ['用法', '每日 1 次，睡前 1 粒', 100]]],
      ['print', '服用後請勿開車或操作機械。', { cls: 'warn' }],
      ['p', '我在鐵櫃裡。她沒看到我躲進來。'],
      ['p', '她在櫃子外面停下來了。歌停了。她在聽。'],
      ['p', '<<不能喘。憋住。>>憋到她走。'],
      ['p', '剛才憋不住喘了一口，她的頭就轉過來。'],
      ['p', '藥吞了兩顆，手比較不抖，看到的怪東西也少了。'],
      ['p', '她走了。我再躲一下'],
      ['blood', '別出聲'],
    ],
  },
  {
    id: 'photoback', type: 'photoback', line: 'guard', place: 'office', title: '合照的背面',
    blocks: [
      ['hand', '87 年尾牙　七樓同仁', { cls: 'cap' }],
      ['names', [
        ['林○蓮', '8/27', true], ['方○遠醫師', '8/28', true], ['吳○慧', '8/29', true],
        ['周○芬護理長', '', false], ['何院長', '', false], ['老陳', '', false], ['我', '', false],
      ]],
      ['hand', '不見的順序。都是 13 號那晚在場、後來沒講話的人。', { ink: 'red' }],
      ['hand', '下一個是誰？', { ink: 'red', cls: 'big' }],
    ],
  },
  // ---------------------------------------------------------------- 封存
  {
    id: 'official', type: 'official', line: 'cover', place: 'office', title: '院長室內部通報',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　院長室', title: '內　部　通　報' }],
      ['kv', [['發文字號', '（88）聖院密字第 0814 號', 100], ['日期', '中華民國 88 年 8 月 14 日', 100], ['受文者', '護理部、嬰兒室、工務組、精神科', 100]]],
      ['stamp', { text: '機　密', shape: 'rect', color: 'red', rot: 6, at: 'top' }],
      ['p', '主旨：有關 8 月 13 日夜間嬰兒室個案，請各單位口徑一致。'],
      ['p', '說明：'],
      ['list', [
        '該新生兒死因一律記載為「先天性心肺發育不全」。停電及備用發電機未啟動一節，不得記入任何紀錄。',
        '產婦林員為本院同仁，為免刺激，不予告知；家屬詢問時，稱嬰兒仍在嬰兒室觀察。',
        '當晚護理紀錄、異常事件報告單一律繳回院長室，另行謄寫。',
        '工務組 5 至 7 月之發電機維修申請單，全數抽回。',
        '九月初衛生局稽查前，林員如持續於院內尋找嬰兒，由精神科收治於 707 病房，必要時加強治療。',
      ]],
      ['sig', [['院長', '何○昌']]],
      ['stamp', { text: '聖羅莎紀\n念醫院院\n長之印', shape: 'seal', color: 'red', rot: 2, at: 'sig' }],
      ['hand', '他說這都是為了醫院。', { cls: 'late' }],
    ],
  },
  {
    id: 'incident', type: 'incident', line: 'cover', place: 'office', title: '異常事件報告單',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院', title: '異常事件報告單', no: '第二聯　單位留存' }],
      ['kv', [['事件日期', '88.8.13', 46], ['時間', '21:52 至 22:35', 54], ['地點', '嬰兒室', 40], ['類別', '[ ]給藥 [x]設備 [ ]其他', 60]]],
      ['h', '事件經過'],
      ['p', '市電中斷，備用發電機未啟動。保溫箱與氧氣設備停止運轉 43 分鐘。保溫箱內新生兒一名（林○蓮之女）復電時已無呼吸，急救至 23:40 無效。'],
      ['h', '可能原因'],
      ['p', '發電機配電箱保險絲老化燒毀。工務組 5、6、7 月三次申請更換，均未核准。'],
      ['sig', [['報告人', '周○芬'], ['職稱', '護理長']]],
      ['h', '院長批示'],
      ['hand', '不予呈報。本單作廢。　何', { ink: 'red' }],
      ['stamp', { text: '作　廢', shape: 'rect', color: 'red', rot: -14, at: 'mid' }],
    ],
  },
  {
    id: 'workorder', type: 'workorder', line: 'cover', place: 'any', title: '維修申請單',
    blocks: [
      ['hd', { org: '聖羅莎紀念醫院　工務組', title: '維修申請單', no: 'No. 003127' }],
      ['kv', [['申請日期', '88.7.26', 50], ['申請人', '陳○川', 50], ['設備', '備用發電機　配電箱', 100]]],
      ['h', '故障情形'],
      ['p', '保險絲座三個都燒黑了，上個月試車跳掉兩次。這是第三次申請。颱風季要是停電，發電機會起不來。嬰兒室、開刀房都靠它。'],
      ['kv', [['所需材料', '保險絲 3 只、保險絲座 3 組', 100], ['估價', '4,800 元', 100]]],
      ['h', '核示'],
      ['hand', '本年度無此預算，明年再議。　何', { ink: 'red' }],
      ['stamp', { text: '駁　回', shape: 'round', color: 'red', rot: -10, at: 'right' }],
      ['hand', '13 號之後我常常想到這個數字。四千八。', { cls: 'late' }],
    ],
  },
  {
    id: 'clipping', type: 'clipping', line: 'cover', place: 'near', title: '剪報',
    blocks: [
      ['print', '晨光日報　中華民國 88 年 9 月 2 日　星期四　第 7 版　地方', { cls: 'folio' }],
      ['print', '聖羅莎醫院一夜人去樓空', { cls: 'headline' }],
      ['print', '院長等六人失聯　大門電子鎖斷電反鎖', { cls: 'deck' }],
      ['cols', [
        ['photo', '聖羅莎紀念醫院大門已貼上封條。（記者攝）'],
        '【本報訊】位於山區的聖羅莎紀念醫院八月三十一日清晨被送貨員發現大門深鎖、無人應門。警方破門進入，院內空無一人，只有七樓護理站的收音機還沙沙作響。',
        '警方表示，院方已在二十九日前把住院病人全數轉出；留守的院長、護理長、精神科醫師、護理師、警衛與維修工共六人，自二十八日起陸續失去聯絡，至今下落不明。現場沒有打鬥痕跡，備用發電機的三只保險絲不翼而飛。',
        '衛生單位原訂九月一日到院稽查。據了解，稽查與八月中旬一名新生兒死亡有關，院方當時以先天疾病結案；嬰兒的母親是院內護理師，已於八月二十七日在院內病逝。',
        '附近居民說，封院這幾天，半夜還聽得見樓上有女人在<<哼搖籃曲>>。',
      ]],
      ['hand', '就是這裡。3/16 去。　哲', { cls: 'margin' }],
    ],
  },
  // ---------------------------------------------------------------- 二十年後
  {
    id: 'flyer', type: 'flyer', line: 'intruder', place: 'near', title: '尋人啟事',
    blocks: [
      ['print', '尋　人', { cls: 'headline' }],
      ['photo', ''],
      ['p', '徐○哲（阿哲），27 歲，網路頻道「廢墟夜行」。2019 年 3 月 16 日深夜獨自進入聖羅莎紀念醫院舊址拍攝，之後失去聯絡。以下是他最後傳來的訊息：'],
      ['chat', [
        ['他', '到了 大門沒鎖 進去囉', '23:52'],
        ['我', '不要待太久', '23:53'],
        ['他', '這裡有人在哼歌', '00:31'],
        ['他', '還滿好聽的', '00:31'],
        ['他', '門自己關起來了 我沒有碰', '00:48'],
        ['他', '姊 這是媽以前唱的那一首', '01:15'],
        ['我', '你在哪？我報警了', '01:16'],
        ['他', '歌停了', '01:40'],
      ]],
      ['p', '有任何消息請聯絡徐小姐：09○○-○○○-○○○'],
      ['hand', '阿哲，回家。', { cls: 'marker' }],
    ],
  },
  {
    id: 'notebook', type: 'notebook', line: 'intruder', place: 'far', title: '筆記本內頁',
    blocks: [
      ['hand', '3/17？　手機沒訊號，用寫的。', { cls: 'lead' }],
      ['list', [
        '她哼歌＝還沒發現我。歌一停就是看到了。',
        '蹲著走她比較不容易看到。跑步、開門關門她都聽得到。',
        '<<玻璃瓶>>！往遠處丟，摔破的聲音她會過去看。救了我兩次。',
        '門上有色條的房間要刷卡，同顏色的卡在別的房間。那種門她打不開，還鎖著的時候裡面是安全的。~可以睡~ 刷開之後就不是了。',
        '相機閃光燈能讓她定住幾秒。底片只剩一張。',
        '不要一直待在暗的地方。我剛剛看到我姊站在走廊上。我姊不在這裡。',
      ]],
    ],
  },
  {
    id: 'receipt', type: 'receipt', line: 'intruder', place: 'any', title: '超商收據',
    blocks: [
      ['rc', { head: ['山腳便利商店', '2019-03-16　22:07'], rows: [['3 號電池 4 入 x2', '238'], ['礦泉水 600ml', '20'], ['打火機', '25'], ['蠟燭 6 入', '39']], total: ['合計', '322'], foot: '謝謝光臨' }],
      ['p', '找到一隻嬰兒鞋。粉紅色，毛線的，鞋底寫「蓮的寶寶」。'],
      ['p', '有一個房間裡擺著小搖籃，旁邊的蠟燭沒點完。有人試過。'],
      ['p', '我把鞋<<放回搖籃>>。她叫到整層樓的燈都在閃，可是我覺得她是在哭。'],
      ['p', '還有兩樣：手環跟照片。放回去一樣她就更兇一次。三樣都放回去會怎樣？'],
      ['p', '我去找。'],
    ],
  },
];
export const MAIN_DOCS = DOCS.map((d, i) => (d.line === 'main' ? i : -1)).filter((i) => i >= 0);
export const LOBBY_DOC = 0;
export const GEN_DOC = 6;

// 每一局要出現哪幾份文件：只由種子與樓層數決定（多人連線時每個人算出來都一樣，所以不用同步）。
//   主線七份一定都在；支線依樓層數多放（1 層 4 份、2 層 7 份、3 層 10 份）：
//   支線的順序由種子洗牌，排前面的整條都放，剩下的名額放下一條的前幾份（當成別條線的引子）。
export function sideDocCount(floors) { return 4 + 3 * (Math.max(1, Math.min(3, floors | 0)) - 1); }
export function pickDocs(seed, floors = 1) {
  const rng = new RNG(((seed >>> 0) ^ 0x51d0c5) >>> 0);
  const lines = rng.shuffle(DOC_LINES.filter((l) => l.key !== 'main').map((l) => l.key));
  let left = Math.min(sideDocCount(floors), DOCS.length - MAIN_DOCS.length);
  const ids = MAIN_DOCS.slice();
  for (const key of lines) {
    for (let i = 0; i < DOCS.length && left > 0; i++) if (DOCS[i].line === key) { ids.push(i); left--; }
  }
  return ids.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 文件 → 虛擬節點樹（{ c: class, f: 字型, d: data-*, k: 子節點（字串或節點） }）。ui.js 把它變成 DOM；
// charset.mjs 走同一棵樹收集每一種字型用到的字，所以畫面上的字跟字型子集一定對得上。
const N = (c, k = [], o = {}) => ({ c, k: Array.isArray(k) ? k : [k], ...o });
const INLINE = /\[\[(.+?)\]\]|~(.+?)~|\{(.+?)\}|<<(.+?)>>|\[( |x)\]/g;
function inline(text, rep) {
  const s = rep ? rep(String(text)) : String(text);
  const out = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    if (m[1] != null) out.push(N('blood-ink', m[1], { t: 'span', f: 'brush' }));
    else if (m[2] != null) out.push(N('d-x', m[2], { t: 'span' }));
    else if (m[3] != null) out.push(N('d-ins', m[3], { t: 'span', f: 'pen' }));
    else if (m[4] != null) out.push(N('d-em', m[4], { t: 'span' }));
    else out.push(N(m[5] === 'x' ? 'd-box on' : 'd-box', [], { t: 'span' }));
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

// opts.rep：改寫文字的函式（多層樓時把「發電機房在這層樓最裡面」換成樓層名稱）
export function docTree(doc, opts = {}) {
  const T = DOC_TYPES[doc.type] || DOC_TYPES.relic, rep = opts.rep, I = (s) => inline(s, rep);
  const kids = [];
  for (const [kind, a, b = {}] of doc.blocks) {
    switch (kind) {
      case 'hd':
        kids.push(N('d-hd', [a.org ? N('d-org', I(a.org)) : null, N('d-title', I(a.title)), a.no ? N('d-no', I(a.no)) : null].filter(Boolean), { f: T.form }));
        break;
      case 'kv':
        kids.push(N('d-kv', a.map(([l, v, w]) => N('d-f', [N('d-l', I(l), { t: 'span', f: T.form }), N('d-v', I(v), { t: 'span', f: 'pen' })], { d: { w: String(w || 100) } }))));
        break;
      case 'h': kids.push(N('d-h', I(a), { f: T.form })); break;
      case 'p': kids.push(N('d-p', I(a), { f: T.body })); break;
      case 'hand': kids.push(N('d-p d-hand' + (b.cls ? ' ' + b.cls : '') + (b.ink ? ' ink-' + b.ink : ''), I(a), { f: 'pen' })); break;
      case 'print': kids.push(N('d-p d-print' + (b.cls ? ' ' + b.cls : ''), I(a), { f: T.form })); break;
      case 'blood': kids.push(N('d-blood', N('blood-ink blood-line', I(a), { t: 'span' }), { f: 'brush' })); break;
      case 'list': kids.push(N('d-list', a.map((s) => N('d-li', I(s))), { f: T.body })); break;
      case 'tbl': {
        const rows = [];
        if (a.head) rows.push(N('d-tr d-th', a.head.map((h) => N('d-td', I(h), { t: 'span' })), { f: T.form }));
        for (const r of a.rows) rows.push(N('d-tr', r.map((cell) => N('d-td', I(cell), { t: 'span' }))));
        kids.push(N('d-tbl ' + (a.cls || ''), rows, { f: T.body }));
        break;
      }
      case 'sig':
        kids.push(N('d-sig', a.map(([l, v]) => N('d-f', [N('d-l', I(l), { t: 'span', f: T.form }), N('d-v d-sign', I(v), { t: 'span', f: 'pen' })]))));
        break;
      case 'stamp':
        kids.push(N('d-stamp at-' + (a.at || 'right'), a.text, { f: 'print', d: { stamp: [a.shape || 'rect', a.color || 'red', a.rot || 0].join('|') } }));
        break;
      case 'label': kids.push(N('d-label', a.map((s) => N('d-ll', I(s))), { f: T.form })); break;
      case 'draw': kids.push(N('d-draw', [], { d: { mark: 'draw' } })); break;
      case 'photo': kids.push(N('d-photo', a ? N('d-cap', I(a)) : [], { f: T.form, d: { mark: 'photo' } })); break;
      case 'ghost':
        kids.push(N('d-ghost', [N('g-year', a.year), N('g-month', a.month + ' 月'), N('g-day', a.day), N('g-week', a.week)], { f: 'print' }));
        break;
      case 'names':
        kids.push(N('d-names', a.map(([n, date, gone]) => N('d-nm' + (gone ? ' gone' : ''), [N('d-n', I(n), { t: 'span' }), date ? N('d-date ink-red', I(date), { t: 'span' }) : null].filter(Boolean))), { f: 'pen' }));
        break;
      case 'cols':
        kids.push(N('d-cols', a.map((s) => (Array.isArray(s) ? N('d-photo', N('d-cap', I(s[1])), { d: { mark: 'photo' } }) : N('d-p', I(s)))), { f: T.body }));
        break;
      case 'chat':
        kids.push(N('d-chat', a.map(([who, text, time]) => N('d-msg ' + (who === '我' ? 'me' : 'him'), [N('d-bub', I(text), { t: 'span' }), N('d-time', I(time), { t: 'span' })])), { f: 'sys' }));
        break;
      case 'rc':
        kids.push(N('d-rc', [
          ...a.head.map((s) => N('rc-c', I(s))),
          ...a.rows.map(([l, r]) => N('rc-r', [N('', I(l), { t: 'span' }), N('', I(r), { t: 'span' })])),
          N('rc-r rc-t', [N('', I(a.total[0]), { t: 'span' }), N('', I(a.total[1]), { t: 'span' })]),
          N('rc-c', I(a.foot)),
        ], { f: 'sys' }));
        break;
    }
  }
  return N('doc t-' + doc.type, kids, { f: T.body });
}

// 這棵樹每一種字型用到的字：{ pen: Set, print: Set, brush: Set, sys: Set }
export function treeChars(node, font = 'sys', out = { pen: new Set(), print: new Set(), brush: new Set(), sys: new Set() }) {
  const f = node.f || font;
  for (const k of node.k) {
    if (typeof k === 'string') { for (const ch of k) if (ch !== '\n') out[f].add(ch); } else if (k) treeChars(k, f, out);
  }
  return out;
}

// 跨局收集（localStorage 裡存文件 id 的陣列）：只留下認得的 id，不重複
export function sanitizeCollection(v) {
  const known = new Set(DOCS.map((d) => d.id));
  const out = [];
  if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && known.has(x) && !out.includes(x)) out.push(x);
  return out;
}

// 跨局收集：存在瀏覽器裡（私密模式、被擋掉時就只算這一局）
const COLLECTION_KEY = 'silentward.docs';
export function loadCollection() {
  try { return new Set(sanitizeCollection(JSON.parse(localStorage.getItem(COLLECTION_KEY) || '[]'))); } catch (e) { return new Set(); }
}
export function addToCollection(id) {
  const set = loadCollection();
  if (!DOCS.some((d) => d.id === id) || set.has(id)) return set;
  set.add(id);
  try { localStorage.setItem(COLLECTION_KEY, JSON.stringify([...set])); } catch (e) { /* 私密模式 */ }
  return set;
}
