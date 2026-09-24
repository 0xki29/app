# Curated overrides: changelog

Newest first. Every row in these files is `ai-draft` ("hiệu đính bởi AI, chờ duyệt") until the owner
reviews it and sets `reviewed` ("đã hiệu đính").

## 2026-09-25 — fixes after the dictionary review (Claude)

All new and changed rows are `ai-draft`. The review's findings are named in brackets.

### New files

- `hanviet-char.tsv` (62 rows): character readings, applied to every word with the character. Found
  by a scan of the word list's first candidate for each character: where it is the Vietnamese word
  for the character's meaning (冷 lạnh, 讀 đọc, 受 thọ…) and no compound confirms it as Sino-Vietnamese,
  checked by hand; the vernacular form is listed and the `hv-vernacular` gate keeps it out of every
  row, curated ones included [DATA-1, missed #30]: 受 thụ, 冷 lãnh, 油 du, 讀 độc, 幕 mạc, 種 zhòng
  chủng, 卷/捲 quyển, 更 gèng cánh, 曾 tằng, 戴 đái, 摸 mô, 箱 tương, 笨 bổn, 尺 xích, 爹 đa, 几 jī kỷ,
  切 qiē thiết, 捕 bổ, 跌 điệt, 茄 qié già, 噴 phún, 割 cát, 喝 hát, 媽 ma, 哭 khốc, 爬 bà, 餅 bính,
  桶 dũng, 爐 lô, 絲 ty, 鋸 cứ, 煎 tiên, 扛 giang, 繩 thằng, 狹 hiệp, 縛 phược, 霉 mai, 椰 da, 撐 xanh,
  腔 xoang, 馱 đà, 扶 phù, 呆 ngai, 鑽 toàn/toản, 創 chuāng sang, 獎 tưởng, 兔 thố, 籠 lung, 框
  khuông, 訝 nhạ, 揣 suỷ, 餃 giảo, 監 jiān giám. Also 奧 áo (Austria is Áo Địa Lợi, not Ảo), 這 zhèi
  giá, 過 guo5 quá (the particle, as 过去 quá khứ; 經過 kinh qua and 通過 thông qua stay word
  readings), and 覺 jiào giác, so 睡觉 reads thuỵ giác, with thuỵ giáo kept searchable [HV-1, (c)].
  The word overrides these made redundant were removed (讀書, 讀音, 冷, 油, 加油, 喝, 媽, 媽媽, 哭, 爬,
  爬山, 更, 接受, 受到, 難受, 餃子, 過 guo5), and so were 公司/司機 (the build spells 司 ty) and 是不是,
  中醫 (the algorithm reads them now).
- `join-deny.tsv` (16 rows): CC-CEDICT entries that must not take a loosely joined CVDICT
  translation, each checked against its English (累 lei2 "họ Lei", 丽 li2 "Hàn Quốc", 科克 Cork
  "nút chai"…) [missed, join]. The join is also one-to-one now: a leftover CVDICT entry two rows would
  take goes to neither.
- `not-proper-noun.tsv` (23 rows): common nouns CC-CEDICT capitalizes — languages (汉语, 英语, 中文…),
  星期天/星期日, 西方, 互联网, 摄氏度, 腊月, 除夕, 华人… — no "Tên riêng" badge and no capital on every
  Hán Việt syllable [DATA-2, DATA-8]. Festivals (春节) keep theirs: Vietnamese capitalizes them too.

### hanviet-word.tsv

- 192 phonetic loanwords set to `-` ("không dùng — từ phiên âm"), reviewed from CC-CEDICT's
  "(loanword)" rows: every HSK one and every multi-character one with pop ≥ 28 — 巧克力, 咖啡, 沙发,
  沙拉, 披萨, 汉堡, 巴士, 的士, 吉他, 幽默, 逻辑, 啤酒, 模特… Calques with a meaningful reading keep it.
- Languages and set words written with only their proper part capitalized: Hán ngữ, Anh ngữ,
  Trung văn, Hoa kiều, Anh bảng…; 比丘 tỳ kheo, 比丘尼 tỳ kheo ni, 可汗 khả hãn.
- 228 rows now.

### vi-gloss.tsv and extra-entries.tsv

- 晚安: "chúc ngủ ngon (nói khi chia tay buổi tối hoặc trước khi đi ngủ; gặp nhau buổi tối thì chào
  晚上好)" — "chào buổi tối" dropped, it taught a beginner's mistake [GLOSS-1].
- 数 shǔ, 定为, 公益性, 不如说: examples made accurate and natural [GLOSS-2].
- 雇佣: the gloss now also on the HSK row 雇傭 (it was only on 僱傭) [DATA-1].
- 复习: the gloss keyed 複習 (the HSK list's form) now follows the HSK tag to 復習 in the build, and a
  gate checks that every HSK 1–2 row is curated [DATA-1, DATA-5].



Source: the AI-drafted HSK 1–2 glosses (1,266 glosses in `vi-gloss.tsv`, 35 word
readings in `hanviet-word.tsv`, 37 classifiers set aside in `classifiers-cvdict-only.tsv`), reviewed
before copying. Changes against those drafts:

### Keys moved to the current CC-CEDICT (2026-09-23)

The drafts used the HSK list's keys, taken from an older CC-CEDICT:

- `是不是|是不是[shi4 bu4 shi4]` → `[shi4 bu5 shi4]` (vi-gloss and hanviet-word)
- `中醫|中医[Zhong1 yi1]` → `[zhong1 yi1]` (vi-gloss and hanviet-word)

### Classifiers only CVDICT lists: restored where right and useful

| Word | Classifier line now |
|---|---|
| 爱好 | 个 (gè) |
| 班 | 个 (gè) |
| 包子 | 个 (gè) |
| 地方 | 个 (gè), 处 (chù) |
| 电影 | 部 (bù), 场 (chǎng) |
| 动作 | 个 (gè) |
| 饭店 | 家 (jiā), 个 (gè) |
| 房间 | 个 (gè), 间 (jiān) |
| 国家 | 个 (gè) |
| 汉语 | 门 (mén) |
| 汉字 | 个 (gè) |
| 老师 | 位 (wèi), 个 (gè) |
| 名字 | 个 (gè) |
| 日期 | 个 (gè) |
| 商店 | 家 (jiā), 个 (gè) |
| 上午 | 个 (gè) |
| 水果 | 个 (gè) |
| 小朋友 | 个 (gè) |
| 星期日, 星期天 | 个 (gè) |
| 医生 | 位 (wèi), 名 (míng), 个 (gè) |
| 中学 | 所 (suǒ), 个 (gè) — 所 added: the standard classifier for schools, as for 大学, 学校 |
| 办法 | 个 (gè), 条 (tiáo) |
| 办公室 | 间 (jiān) |
| 部分 | 个 (gè) |
| 湖 | 个 (gè) — 片 not restored (literary) |
| 花园 | 个 (gè), 座 (zuò) |
| 活动 | 个 (gè), 项 (xiàng) |
| 科学家 | 位 (wèi), 个 (gè) — 位 added, as for 老师, 医生 |
| 家庭 | 个 (gè), 户 (hù) |
| 节目 | 个 (gè), 场 (chǎng), 项 (xiàng), 台 (tái), 套 (tào), 档 (dàng) |
| 客人 | 位 (wèi), 个 (gè) — 个 added |
| 礼物 | 个 (gè), 件 (jiàn), 份 (fèn) |

Still left out: 爸爸 个 (one does not count one's father), 国 个 and 外国 个 (unidiomatic: 一个国家),
爷爷 个.

### Classifiers that mislead a beginner: removed

- 年: 个 removed (一年, never 一个年 for "one year").
- 桌子: 套 removed (a set of furniture, like the 椅子 套 and 照片 套 the drafts had already dropped).
- 重复: 个 removed (a verb; "一个重复" is not what a learner needs).
- 信心: 个 removed (uncountable: 有信心).
- 筷子: 双 (shuāng) moved first, the classifier for a pair of chopsticks.

Checked and already absent from the drafts: 椅子 套, 照片 套, 座 个, 手机 支.

### Slang and vulgar senses: labelled and last

- 背 bèi: "(khẩu ngữ) xui; xui xẻo; đen đủi" → "(tiếng lóng) xui; xui xẻo; đen đủi", moved last
  (CC-CEDICT marks it slang).
- 干 gàn: added last "(tiếng lóng) khử; giết" and "(thô tục) quan hệ tình dục; cũng dùng để chửi tục"
  (CC-CEDICT senses the draft left out; a learner should know them).
- 日 rì: added last "(thô tục) quan hệ tình dục; cũng dùng để chửi tục".
- Already labelled and last: 小姐, 鸡, 靠, 老朋友, 绿, 开车, 楼上 (and 去, 方便 as "(nói tránh)").

### Added

- `hanviet-word.tsv`: the conventional readings the research memo lists, which pinyin does not
  predict — 調查 điều tra, 將軍 tướng quân, 使者 sứ giả, 司令 tư lệnh, 容易 dung dị, 印刷 ấn loát
  (通過 thông qua was already there). 41 corrections in all.
- `vi-gloss.tsv`: 24 entries that had no Vietnamese at all — the HSK words 与此同时, 致力于, 泄露, 不予
  and frequent entries 这 zhèi, 一个, 它 (牠), 每个, 教授 jiāo, 呀 yā, 所有人, 并未, 一人, 买卖 mǎimai,
  一刻, 媳妇 xífu, 一员, 雇佣, 警员, 苹果 (Apple), 微博 (Weibo), 欧美, 基地 (al-Qaeda), 人大. 1,290
  glosses in all.
- `extra-entries.tsv` (new): the 25 HSK 3.0 words CC-CEDICT has no entry for (车上 at level 1; 不太,
  不一会儿, 见过, 送到 at level 2; 放到, 能不能, 眼里, 有劲儿, 城里, 很难说, 一番, 指着 and 12 words of
  levels 7–9), so every HSK word has an entry.
