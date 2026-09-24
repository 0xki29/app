# Chinese Notebook

A handwriting-first Chinese learning web app for Vietnamese learners, as a static site (GitHub
Pages): no backend, no account, everything the learner does stays in their browser.

- **Tra cứu** — a Chinese→Vietnamese dictionary of 125,126 entries, searched on the device by hanzi
  (simplified or traditional), pinyin (with or without tones), Âm Hán Việt and Vietnamese meaning.
  An entry shows pinyin with tone marks (colored per tone) and a listen button, the Âm Hán Việt,
  short Vietnamese meanings that say where they come from, and the word's characters with their
  stroke order. Tapping the pinyin opens a hand-written guide, "Pinyin cho người Việt". There are no
  Vietnamese-letter respellings of Mandarin ("phiên âm bồi"), since they teach wrong sounds.
- **Sổ ôn tập** — a review deck of writing cards, one per character, each keeping the word it came
  from. The deck is scheduled with FSRS from the learner's own rating after writing from memory. An
  empty deck offers the HSK 3.0 level-1 writing list, 10 characters at a time, most frequent first,
  each with a word it is learned in.
- **Luyện viết** — the writing workspace, with Xem (the character writes itself in stroke order),
  Tô theo (trace) and Nhớ lại (recall). After each attempt the app gives a heuristic shape score and
  a stroke-by-stroke review. The workspace runs a review session, and free practice of any
  character that has stroke data (9,574 characters).

The dictionary and stroke data are open data sets, built reproducibly from pinned sources by
`npm run data:build` (see [Dictionary](#dictionary-tra-cứu) and [License](#license)). v1 has no
example sentences, no recorded audio (listening uses the device's voice) and no offline mode: no
service worker, only the browser cache and IndexedDB.

## Run

Node `^22.13 || ^24 || >=26` (`engines` in `package.json`: what Vite, Vitest and ESLint all support).

```bash
npm install
npm run data:build       # once after cloning: dictionary, stroke and license files → public/ (≈ 20 s)
npm run dev              # http://localhost:5173
npm run dev -- --host    # also serve on your LAN (for phone testing, see below)
npm test                 # unit tests (Vitest, node environment; app and data scripts)
npm run lint             # ESLint, type-aware (correctness rules only, no style)
npm run typecheck        # TypeScript 7 for src/ and for e2e/ (with playwright.config.ts and vite.config.ts)
npm run build            # typecheck of src/ + production build (copies public/ into dist/)
npm run test:e2e         # data:ensure, build, then Playwright in the installed Google Chrome (preview on 127.0.0.1:4180)
npm run check            # lint + typecheck + unit + build (what CI runs before e2e)
npm run data:ensure      # data:build only if public/ is missing or older than its inputs
npm run data:check       # the whole data build and its gates, writing nothing (for PRs that edit data/)
```

**Data first.** Without `npm run data:build` the app still runs, but the dictionary says it has no
data (on the dev server, with the command to run), every character falls back to the font glyph (no
animation, no stroke review), and `npm run build` warns that it ships without data. The first run downloads about
74 MB of pinned inputs; the wordfreq wheel alone is 54 MB, of which the build keeps a 1.7 MB list.
It keeps 21 MB in `.cache/dict-src/`, so later runs download nothing. The generated files in
`public/dict/`, `public/strokes/` and `public/licenses/` are gitignored. `npm run test:e2e` calls
`data:ensure`, which rebuilds only when the lock file, the curated data or the build scripts changed
since the last build (stamp in `.cache/data-build.json`).

**TypeScript, twice.** The compiler is TypeScript 7 (`"@typescript/native": "npm:typescript@^7"`). The
`typescript` entry in `package.json` is TypeScript 6 (`@typescript/typescript6`) and exists only because
typescript-eslint needs a TypeScript JS API, which TS 7 does not ship. Both packages declare a `tsc`
bin, and which one `node_modules/.bin/tsc` (so `npx tsc`) links to depends on npm's install order, so
the scripts call TS 7 by path (`node node_modules/@typescript/native/bin/tsc`), and CI fails unless
that prints `Version 7.`. An editor's "use workspace TypeScript" gets TS 6's language service. Drop
the alias once typescript-eslint supports TS 7.

`npm run test:e2e` builds first and then only previews `dist/`, on a port of its own (4180, not
`vite preview`'s default); a server already on that port is an error, never reused, so the build
tested is always the one just made.

Debug HUD: in dev it is always available via the **HUD** chip (top right of the prompt). In a production
build, add `?debug` to the URL to show the chip, or `?debug=1` to open the HUD immediately. Its code is
a separate chunk (≈ 5 KB), fetched only then, inside its own error boundary.
`?desync=1` opts into low-latency `desynchronized` canvases (experimental). It is off by default: on GPU
compositors such as Chrome on Windows a desynchronized canvas becomes a hardware overlay without alpha,
and the writing box turns black. Using it for real would need an opaque single-canvas design.

## Screens and routes

Hash routes (`src/app/router.ts`; hash, because the site is static at any sub-path, so a reload never
asks the server for a path it does not have). A screen is one entry in `ROUTES` plus one case in
`src/app/App.tsx`.

| Route | Screen | Where from |
|---|---|---|
| `#/` | **Hôm nay** (`TodayScreen`): cards due and new today, "Bắt đầu ôn"; an empty deck offers "Thêm 10 chữ HSK 1" | home, bottom nav |
| `#/tra-cuu?q=…` | **Tra cứu** (`DictionarySearchScreen`): one box for every kind of query; the query stays in the address | bottom nav (back to the last search) |
| `#/tu/<encodeURIComponent(key)>` | **Mục từ** (`EntryScreen`), key `trad\|simp[numbered pinyin]`, e.g. `學生\|学生[xue2 sheng5]` | a search result, a cross-reference |
| `#/pinyin` | **Pinyin cho người Việt** (`PinyinGuideScreen`) | tapping an entry's pinyin; the search screen |
| `#/nguon-du-lieu` | **Giới thiệu & nguồn dữ liệu** (`CreditsScreen`), generated from the data manifest | the search screen |
| `#/so-on-tap` | **Sổ ôn tập** (`DeckScreen`): every card, remove, new cards per day, export / import | bottom nav |
| `#/on-tap` | **Ôn tập** (`SessionScreen`): today's queue in the workspace, then a summary | "Bắt đầu ôn" |
| `#/luyen/<hex>` | **Luyện viết** (`PracticeScreen`): free practice of one character by code point (`#/luyen/5b66` = 学), all three tabs, "+ Ôn tập" | an entry's "Luyện viết", a card in the deck |

The bottom navigation (Hôm nay · Tra cứu · Sổ ôn tập) is on every screen except the full-screen
workspace (a session, free practice). A practice's back button returns to the last screen that was
not one (the entry it was opened from, the deck), or to Hôm nay when it was opened directly. Each
screen has its own error boundary, so a failing screen shows the error page while the navigation
still works. The viewport lock (no page scroll, bounce or pull-to-refresh) is set on
`html[data-lock]` only while the workspace is mounted; every other screen scrolls normally.

**Back and history** (`src/app/history.ts`). Each history entry keeps, in `history.state`, the hash it
was reached from, where the page was scrolled to and which result lists or senses were expanded. So
the browser's (or phone's) Back returns to a screen as it was left, and an in-app back link — the
entry's "‹ Tra cứu", a practice's "Quay lại", the pinyin guide's and credits page's back arrow, the
session's "Về trang Hôm nay" — is the browser's Back when that is where the screen was opened from,
or replaces the current entry otherwise: it never adds one, so Back does not reopen the screen just
left. A new screen opens at its top and takes focus on its heading (unless it put focus somewhere
itself, like the search box), and the page title names the screen, or the word on an entry
("学生 xué sheng · Tra cứu").

## Dictionary (Tra cứu)

Code in `src/dict/` (its [README](src/dict/README.md) has the architecture, the search design and the
client contract). The data pipeline is in `scripts/dict/`; its [README](scripts/dict/README.md)
documents every step, gate and output column.

**An entry shows**

- the headword, simplified and traditional;
- pinyin with tone marks, each syllable in its tone's color (`--tone-1…5`, each ≥ 4.5:1 contrast;
  the mark carries the tone too). CC-CEDICT's citation tones are shown as given (neutral tones kept, no
  一/不 sandhi). Tapping the pinyin opens the pinyin guide;
- a listen button (Web Speech API, a zh-CN voice first, never Cantonese). Without a Mandarin voice
  it is disabled and says why ("Máy chưa có giọng đọc tiếng Trung"). On an entry that is not the
  character's usual reading (了 liǎo), a note warns that the voice may say the usual one;
- the **Âm Hán Việt**, taken from the traditional form and the reading of each character in the word
  (行 xíng → hành, háng → hàng; 長 cháng → trường). Other readings are listed as "cũng đọc: …". A
  reading set by curation says "(AI đề xuất, chờ duyệt)" until the owner reviews it;
- the meanings: the first four senses, then "Xem thêm". Notes in parentheses are quieter,
  cross-references are links, and classifiers are listed last ("Lượng từ: 个 (gè)"). A chip says
  where the Vietnamese comes from, and "Báo lỗi" opens a prefilled GitHub issue. The issue contains
  only the entry and the data version;
- HSK 3.0 level, proper-noun and variant badges, and the other readings of the same character;
- "Thêm vào sổ ôn tập" (see [Review deck](#review-deck-sổ-ôn-tập-fsrs-and-sessions));
- each character of the word, with its reading, a small stroke-order animation (it plays only while
  on screen and respects reduced motion) and "Luyện viết" for its simplified and traditional forms. A
  character's card is the row the word means (`src/dict/mainForm.ts`): the word's traditional form of
  it (发 in 头发/頭髮 is 髮 fà "tóc", not 發 fā "gửi"), its reading there, and never a row that only
  stands in for another form (台 "(văn cổ) ông" → 臺 "đài"). A character without stroke data says so
  instead. Stroke order follows mainland (PRC) conventions, also for traditional characters, and the
  page says so.

**Labels: how far to trust a line** (the `flags` column; the credits page explains them too)

| Shown | Flag | Meaning |
|---|---|---|
| chip **"bản dịch máy"** | `mt` | Vietnamese from CVDICT: CC-CEDICT translated by a fine-tuned LLM, reviewed by its author. Most entries are fluent; some basic words are stiff or wrong |
| chip **"hiệu đính bởi AI, chờ duyệt"** | `cur-ai` | rewritten for learners by an AI (HSK 1–2 words, and a few frequent entries that had no Vietnamese), not yet reviewed by a person; on the 25 entries CC-CEDICT lacks (`added`), the line says the AI wrote the entry |
| chip **"đã hiệu đính"** | `cur` | curated and reviewed by the owner (none yet) |
| chip **"chưa có bản dịch"** | `en` | no Vietnamese yet: the CC-CEDICT English is shown, marked `lang="en"`, and searched only as English |
| Hán Việt underlined with dots, "(chưa chắc chắn)" | `hvlow` | a low-confidence reading: the character's reading under another pinyin |
| … "(có thể là âm Nôm)" | `hvlow`, `hvnom` | … from Unihan kVietnamese, which mixes in Nôm readings |
| "(AI đề xuất, chờ duyệt)" after the Hán Việt | `hvcur-ai` | a reading set by curation (a word, or a character everywhere: 冷 lãnh, 受 thụ, 睡觉 thuỵ giác), not yet reviewed |
| "không dùng — từ phiên âm" | hv `-` | a phonetic loanword whose Hán Việt reading means nothing (192, set by curation: 巧克力, 咖啡, 沙发…) |
| badge "Tên riêng", every syllable capitalized | `pn` | a proper noun (CC-CEDICT capitalizes its pinyin), except common nouns it capitalizes by English habit (汉语, 星期天, 西方: `not-proper-noun.tsv`) |
| "Chưa có dữ liệu nét viết cho chữ này" | `nostroke` | a character without stroke data: no animation, no writing card |

**Data sources** (pinned in `scripts/dict/sources.lock.json`, checked by size and SHA-256)

| Source | Gives | License |
|---|---|---|
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) 2026-09-23 (MDBG export, decompressed snapshot in `data/sources/`) | the entries (125,101), pinyin, English | CC BY-SA 4.0 |
| [CVDICT](https://github.com/ph0ngp/CVDICT) commit c379d909 | Vietnamese for 117,398 rows (machine translation) | CC BY-SA 4.0 |
| [hanviet-pinyin-words](https://github.com/ph0ngp/hanviet-pinyin-words) 2.1.7 | Hán Việt per character and pinyin | MIT |
| [Unihan](https://www.unicode.org/reports/tr38/) 18.0.0 | low-confidence Hán Việt fallback, readings, variants | Unicode License V3 |
| [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1 `large_zh` | word frequency, for the rank | CC BY-SA 4.0 |
| [ivankra/hsk30](https://github.com/ivankra/hsk30) commit 4ff9e391 | HSK 3.0 levels and the 1,200-character writing list | MIT |
| [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0.1 (Make Me a Hanzi) | stroke outlines and medians, 9,574 characters, copied byte for byte | Arphic Public License |
| `data/overrides/` (this repository) | curated glosses, word and character readings, 25 HSK words CC-CEDICT lacks, join and proper-noun corrections | CC BY-SA 4.0 |

The build writes the license texts and a `THIRD_PARTY_NOTICES.md` (attribution, license, changes
and the exact input of every source) into `public/licenses/`. The credits page (`#/nguon-du-lieu`) is
generated from the manifest's `sources`: attribution, license links, what was changed, how far to
trust the Vietnamese, and download links for the plain TSV shards (CC BY-SA asks that the data stay
downloadable as plain files).

**Rebuilding the data**

- `npm run data:build` fetches (cached), verifies, builds and runs the gates, then writes
  `public/dict/v1/` (manifest and 5 shards), `public/strokes/v2.0.1/`, `public/licenses/` and
  `data/build-report.json`. The report is committed: counts, coverage and sizes, no timings, so a data
  change shows in review.
- The gates (the build writes nothing if one fails): checksums; entry counts within ±2% of the lock;
  every CC-CEDICT line parsed; every override key resolves and no curated cell is empty; curated
  readings look like Vietnamese syllables; no row ships a vernacular form the character table rules
  out (读者 is never "đọc giả"); NFC; no row without meaning; pinyin and Hán Việt syllable counts;
  Hán Việt coverage ≥ 98.5% (98.59% today); the gold set of 46 polyphone readings: the algorithm
  may miss 2 (44 today), the shipped column none; every HSK level-1 word has an entry; every HSK 1–2
  row has a curated gloss; every source has a notice and a real license text. The written shards are
  then read back and compared. The golden search queries (`data/golden/search-queries.tsv`: 学生。,
  xin chao → 你好, con lợn → 猪, người → 人, Hàn Quốc → 韩国 …) run in `npm test` on the built data.
- **Updating a source:** change its URL/version, `bytes` and `sha256` in the lock (and `expect` if the
  entry count moves), run `npm run data:build`, review the diff of `data/build-report.json`, commit.
  CI's download cache is keyed on the lock file, so it refreshes by itself.
- Every HTTP request carries only the generic User-Agent in the lock file.

**Reviewing curated rows.** The curated files in `data/overrides/` are tab-separated with `#`
comments and a header row, keyed in CC-CEDICT form (`愛|爱[ai4]`). Every row is `ai-draft` today.
To accept one:

1. Open `data/overrides/vi-gloss.tsv` (meanings; senses separated by `/`, a classifier line last as
   `Lượng từ: 个 (gè)`), `hanviet-word.tsv` (word readings, `-` for a loanword), `hanviet-char.tsv`
   (a character's reading everywhere, with the vernacular form that must never ship),
   `extra-entries.tsv` (entries CC-CEDICT lacks) or `not-proper-noun.tsv`. Correct the text if
   needed, and flip the row's `status` column from `ai-draft` to `reviewed`. Only the owner sets
   `reviewed`. (`join-deny.tsv` has no status: a row there only keeps a wrong CVDICT translation off
   an entry.)
2. Note the change in `data/overrides/CHANGELOG.md`.
3. Run `npm run data:check` (all gates, nothing written), then `npm run data:build`. The report's
   `vi.curatedReviewed` goes up, and the entry now shows **"đã hiệu đính"**.
4. Commit the TSV, the changelog and `data/build-report.json`.

A slang or vulgar sense goes last, marked "(tiếng lóng)" or "(thô tục)": a unit test enforces it.
Mistakes found by learners come in as "Báo lỗi" issues.

**Search, loading, caching.** The dictionary runs in a Web Worker (`src/dict/worker.ts`, 35 KB), which
starts the first time something needs it: the search screen, an entry, or a practice prompt. The worker
first fetches the manifest (network first) and the core shard (the 30,000 most common entries,
1.3 MB gzip), which are searchable at once; the stroke availability list comes beside them and holds
up only what reports stroke data. The four other shards download in the background and are added in
time slices, so searches keep being answered meanwhile. Every shard is checked by size and SHA-256,
with a 20 s stall timeout and retries at 0.5 / 1 / 2 / 4 s; the manifest and the list get the same
retries and at most 10 s per attempt. Once everything is in, a snapshot of the index goes to
IndexedDB (`cn-dict`), so the next visit starts from it: only the manifest is fetched, to check the
data version — and when it cannot be (offline, a Wi-Fi login page, a 404 mid-deploy), the saved copy
is used. Without data at all the screens say so to the learner with "Thử lại" (the dev server adds
"chạy npm run data:build"); if the rarer words fail, an entry among them says it could not be loaded,
not "not found". The score is a match tier plus popularity; a short Latin query that matches in
several ways ("an": pinyin ān/àn, Hán Việt an/án, meaning ăn) is shown in groups (Theo pinyin / Theo
âm Hán Việt / Theo nghĩa; a group keeps its best 30 and says how to narrow the rest). The Vietnamese
folding treats accented and unaccented input the same (đ = d, kỳ = kì, hoà = hòa), but typed
diacritics that disagree (mèo ≠ mẹo) mark another word. A Vietnamese phrase equal to a gloss beats a
pinyin or Hán Việt reading of a rare word ("xin chao" → 你好, not 新潮); a gloss that is a pattern
("người …"), is narrowed by a note ("uống (thuốc)") or a label ("(miệt thị) Hàn Quốc"), or is a later
sense ranks below the word itself; a leading classifier is optional ("con lợn" → 猪). The query is
cleaned first (punctuation, emoji, full-width letters; with hanzi, only the hanzi runs are searched:
"学生。", "学sheng"). English matches only entries without Vietnamese, and the results say so when
they are mostly English.

**Measured** (125,126 entries, production build, local preview so network time is excluded,
desktop i5-6400). **1×** = the production worker in Chrome. **4×** = the same engine on the page's
main thread under CDP CPU throttling 4×, a stand-in for a mid-range phone: CDP cannot throttle a worker.

| | 1× (worker) | 4× (throttled stand-in) |
|---|---|---|
| core searchable, from start | 0.74 s (index 0.45 s) | 2.9 s (index 2.5 s) |
| everything indexed | 3.2 s (2.3 s of index work) | 10.2 s (7.0 s of index work) |
| a search while the rest is added (round trip) | ≤ 79 ms | ≤ 37 ms |
| warm start from the IndexedDB snapshot | 0.21–0.23 s (worker); 0.36 s from reload to the first result on screen | 0.80 s |
| snapshot write (once, after loading) | 0.41 s | 0.90 s |
| median query, the hardest ("an", "ăn", "hành", "a") | 2.6–4.2 ms | 17–27 ms |
| worst first run of a query | 10.3 ms ("ăn", "hành") | 76 ms ("hành") |
| median query, a word by hanzi or pinyin (学生, 行, xuesheng, xue2sheng1, xuéshēng, xues) | ≤ 0.5 ms | ≤ 2.3 ms |

On a real phone these numbers are still unmeasured (see [Known limitations](#known-limitations)).

## Review deck (Sổ ôn tập), FSRS and sessions

Code in `src/deck/` (plain TypeScript over a storage interface, plus the four screens).

- **Cards.** One **writing card per character** (id `c:<hex code point>#write`). "Thêm vào sổ ôn tập"
  on an entry adds a card for each character of the word that has stroke data, with the word as the
  card's context (key, simplified form, pinyin, first meaning, whether it is a proper noun). The
  result is reported: added, already in the deck, or left out because a character has no stroke
  data. A character without stroke data cannot get a card, and the button says why; so does a browser
  that keeps no data (private mode). Free practice has "+ Ôn tập" for its character (no context). On
  an empty deck, Hôm nay offers **"Thêm 10 chữ HSK 1"**: the next 10 characters of the HSK 3.0
  level-1 writing list (300 characters, from the manifest), most frequent first (的 是 一 在 不 …),
  skipping characters already in the deck, each with the word it is learned in (the manifest's
  `hskContext`: 么 in 什么, 汉 in 汉语) so its prompt shows the reading and a curated meaning. The
  list position is saved only once the cards are in (a failed add offers the same characters again),
  and a list that cannot be loaded offers "Thử tải lại", never "no list". The same button comes back
  once no new cards are waiting. The prompt reads a character's row the way the entry page does (the
  context word's traditional form and reading).
- **Scheduling: FSRS** (ts-fsrs, default parameters, fuzz off). The grade is the learner's own
  rating after Nhớ lại, never the automatic score: **Sai → Again, Gần đúng → Hard, Đúng → Good** (no
  Easy). A new card rated Sai / Gần đúng / Đúng comes back in 1 / 6 / 10 minutes; Đúng twice graduates
  to 2 days, then about 11. A learning day starts at **04:00** local time: a card in the review state
  is due for the whole learning day, and a card in a learning step is due at its minute (Sổ ôn tập
  words it the same way: a review card due later today is due "bây giờ"). New cards per day: 10 by
  default (5–30 in Sổ ôn tập). Hôm nay refreshes when the next card comes due, at the start of the
  next learning day, when the app comes back to the foreground and when the network is back.
- **A session** (`#/on-tap`, pure reducer `session.ts`). The queue is fixed at the start: the due
  reviews (oldest first), then the day's new cards. A **new card** goes **Xem → Tô theo → Nhớ lại**, a
  **review** is **Nhớ lại** only, and each ends with the self-rating. On a review, "Không nhớ?" opens
  Xem and Tô theo for that card, and its rating is logged as `peeked`. **"Sai"** brings the card back
  after 3 other cards (last if fewer are left), as a Nhớ lại, at most twice per session; when no other
  card is left it comes straight back as peeked (its answer was just on screen). The prompt
  shows the reading, the Âm Hán Việt (hidden in Nhớ lại) and the meaning from the dictionary, plus
  the context word with the character masked in Nhớ lại ("＿生 · học sinh"). The session reuses one
  workspace, so the engine and canvases survive from card to card. "Dừng buổi ôn" asks before leaving;
  every rating is saved as it is made. The summary counts characters, ratings and Đúng / Gần đúng /
  Sai, says when the next card is due, and offers "Ôn tiếp" when more are due already; it takes focus
  on its heading, and the last rating and the results are announced through a live region that
  outlives the workspace.
- **Storage.** IndexedDB `chinese-notebook` (via idb): `cards` (the current FSRS state of each card),
  `reviews` (an **append-only log**: rating, mode new/review/again, previous state, peeked, score,
  stroke tally, duration) and `meta` (settings, the HSK cursor, and when each card was last removed).
  Writes run one at a time. A review is logged at the time the schedule used: never before the card
  was added or its last review (a clock set back, a file from a device whose clock ran ahead), so any
  card's state can be recomputed from its log (`scheduler.replay`), and tests check that it equals the
  stored one, clock trouble included. `peeked` is true only when the answer was on screen before that
  recall (the answer shown after writing from memory is no peek). Other tabs hear about changes
  (BroadcastChannel); a tab whose database another tab upgraded (a newer app) says to reload the page,
  not that storage is blocked. `navigator.storage.persist()` is asked once, on the first card.
- **Export / import** (Sổ ôn tập → Sao lưu): one JSON file, `{ format: "chinese-notebook-deck",
  version: 1, cards, reviews, meta: { settings, hskCursor, removed } }`. Importing merges the cards and
  the logs of both devices and recomputes every affected card from the merged log; the FSRS state in
  the file is never trusted, and neither are its times (a record dated before 2020 or more than a day
  after the export is left out) or its stroke tallies (counts only). Removals merge too, the later per
  card: a card removed on either side after it was added there stays removed — an old backup does not
  bring it back — and a card added again after its removal starts afresh.
- **Free practice** (`#/luyen/<hex>`) of any character: all three tabs, the rating optional and not
  recorded (it is not a scheduled review).

The dictionary itself (the index snapshot, `cn-dict`) is a cache and can be dropped at any time. The
deck is the learner's data: nothing else keeps it, so export it to keep a copy.

## License

- **Code:** MIT — see [`LICENSE`](LICENSE).
- **Data keeps its own licenses.** It ships as separate, plain files next to the app, never inside
  the code bundle:
  - the dictionary shards (`dict/v1/*.tsv`), the curated files in `data/overrides/` and
    `data/sources/`: **CC BY-SA 4.0** (CC-CEDICT, CVDICT, wordfreq, our curation);
  - Hán Việt readings from hanviet-pinyin-words and the HSK lists from ivankra/hsk30: **MIT**;
  - Unihan: **Unicode License V3**;
  - stroke files (`strokes/v2.0.1/*.json`, byte-for-byte hanzi-writer-data / Make Me a Hanzi):
    **Arphic Public License**.
- **Every build ships the notices.** `npm run data:build` generates `public/licenses/`: the license
  texts, `ARPHICPL.TXT` and `THIRD_PARTY_NOTICES.md`, with attribution, license, changes and exact
  input for each source. Vite copies them into `dist/licenses/`, and `vite.config.ts` fails a build that
  has the data but not its notices. The in-app page `#/nguon-du-lieu` is generated from the same
  manifest. The test fixtures in `src/test/fixtures/strokes/` keep their own `ARPHICPL.TXT` and README.
- **Dependencies** keep their own licenses (React, scheduler, perfect-freehand, ts-fsrs: MIT; idb:
  ISC). The minified bundle drops their notices, so every build also ships `licenses/third-party.md`,
  which lists each bundled package with its license text (Vite's `build.license`).

## CI and deploy (GitHub Pages)

One workflow, `.github/workflows/ci.yml`:

- **Every push to any branch, and every pull request from a fork:** job `check` on Node 24 — `npm ci`
  → **data:build** (the pinned downloads cached with `actions/cache`, keyed on the lock file's hash;
  every gate) → lint → typecheck (fails unless the compiler is TS 7) → unit tests → build → a check
  that `dist/` holds the dictionary, stroke files and notices (it also logs their sizes) → e2e
  (installed Chrome, preview of that `dist/`). The Playwright report is uploaded when a step fails. Job `node-min`
  runs data:build, lint, typecheck, unit tests and build on Node 22.13, the oldest Node `engines`
  promises. A pull request from a branch of this repository runs neither: its push was already
  checked.
- **Push to `main`, or a manual run on `main` (Actions → CI → Run workflow):** the `check` job also
  uploads that same, tested `dist/` (app + data) as the Pages artifact, and job `deploy` (needs `check` and
  `node-min`) publishes it. Nothing is deployed unless every check passed. Other branches are checked,
  never deployed.
- A newer push cancels a running check on the same branch, except on `main`, so a deploy is never cut
  off halfway (`deploy` also has its own `pages` concurrency group, never cancelled). A manual run on
  `main` that replaces a queued push run checks and deploys the same, newest commit.

**Site size** (measured on the build of this data version): `dist/` is 46.5 MB in 9,595 files. That is
32.3 MB of stroke files (9,577 files, fetched one per character on demand), 13.6 MB of dictionary
shards (5.8 MB gzip; only the 1.3 MB gzip core is needed to search), 0.5 MB of app code (JS 142 KB
gzip) and 49 KB of licenses. The Pages artifact is a 54 MB tar, about 19 MB compressed, well under
the Pages limits (1 GB site). GitHub Pages serves gzip and sends `max-age=600` on every file, so the
browser keeps the data for 10 minutes; after that it revalidates. The IndexedDB snapshot covers the
dictionary between visits.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/<repo>/` (assets use relative URLs, so any repo
name works). Add `?debug=1` to open the HUD on the deployed site.

GitHub Pages is HTTPS, i.e. a secure context — so `getCoalescedEvents()` and `crypto.subtle` (the
shard checksums) work on a phone that opens the deployed URL directly, no USB forwarding needed.

## How it works

```
main.tsx     installGlobalErrorHandlers() · <ErrorBoundary context="app"> · <App>
App          hash router (router.ts) → one screen, inside its own ErrorBoundary; bottom nav except in the workspace
  Hôm nay · Sổ ôn tập · Ôn tập · Luyện viết   src/deck/ → deck (api.ts: IndexedDB "chinese-notebook", FSRS)
  Tra cứu · Mục từ · Pinyin · Nguồn dữ liệu    src/dict/ → dictionary client ⇄ Web Worker (index, search, "cn-dict" snapshot)
  Ôn tập and Luyện viết render the practice workspace with an item (character + dictionary info + context word):
React (UI state only)
  PracticeWorkspace ── practiceReducer (attempt.ts): item, mode, phase, attempt   (never re-renders while writing or animating)
   ├─ HandwritingCanvas  mounts once, calls engine.attach(); re-renders on char/mode/review change (or canvasError) only
   │   ├─ StrokeOrderView   SVG reference from stroke data (font glyph if a character has none; spinner while it loads)
   │   └─ StrokeNumbers     stroke-number badges; subscribes to the engine itself (once per committed stroke)
   ├─ Controls           subscribes to engine snapshot → re-renders once per committed stroke
   │   └─ StrokeControls    (Observe) subscribes to animator snapshot → re-renders ≈ once per stroke
   ├─ ResultPanel        after scoring: headline, issues, then buttons (the self-rating after Nhớ lại)
   ├─ LiveRegion         one persistent role=status region: the toasts (results are read from their heading)
   └─ DebugHud           lazy chunk; polls engine.stats every 250 ms into a <pre> (no React state)
        │ commands: undo() clear() reset() setInputEnabled() flushInput() setStrokeColors() setInk()
        ▼
HandwritingEngine (plain TypeScript)
  InputController  pointer events → normalized points (coalesced samples, 1 active pointer + 1 watched touch)
   └─ inputPolicy  which contacts become strokes: taps, palms, pen priority, lost pointerups (pure)
  InkModel         committed strokes + undo history + revision (source of truth, pure, unit-tested)
  Renderer A/B     QuadRenderer (incremental Bézier) | FreehandRenderer (perfect-freehand)
  Layers           [DOM grid + reference] → static canvas → live canvas → tail canvas → [DOM reveal]

StrokeAnimator (plain TypeScript)  rAF loop → dash offset / data-state on StrokeOrderView's paths
strokeData.ts      fetch strokes/v2.0.1/<hex>.json (retry, in-memory cache) ← availability list in the manifest
```

Per pointer sample: `pointermove` → points appended to the current stroke → one `requestAnimationFrame`
draw of the live layers. On `pointerup` the stroke is added to `InkModel`, drawn once onto the static canvas,
and the snapshot changes (this is the only moment React hears about it). Undo, clear, resize, DPR change,
renderer switch and canvas context loss all redraw from the model — never from a bitmap.

**Engine API** (saving, replay, review):

- Every stroke has an `id` (random per-engine prefix + counter), `startedAt` (epoch ms) and `end` — how it
  ended (see Input policy). `Point.t` stays ms since the stroke's first sample.
- `getInk()` returns a deep copy with the ink's `revision`, which increases on every change (stroke,
  undo, clear, reset of non-empty ink, `setInk`) and is never reused; `snapshot.inkRevision` is the same
  number. A stroke still being written is not in it: `flushInput()` commits it first (end
  `interrupted`), or drops it if it never moved (a tap, or a thumb resting on the box).
- `setStrokeColors(colors, revision)` ignores colors computed for an older revision; any change to the
  ink drops them anyway.
- `setInk(ink)` restores saved ink: validated by `parseInk` (throws a `TypeError`, changing nothing, on
  bad data — a hole in a sparse array, which structured clone keeps, included), copied, redrawn, no
  undo entry. `onStrokeCommitted` fires once per stroke the learner adds.
  Store `getInk().strokes`: `parseInk` drops unknown fields such as `revision`.
- `attach()` never throws for a missing 2D context: the engine stays inert and reports
  `snapshot.canvasError`; the box then says so (see Errors).

## Input policy

`src/handwriting/inputPolicy.ts` decides which pointer contacts become strokes — pure functions,
unit-tested; `InputController` applies them. Distances are in box units (1 = the side of the box).

- **Taps are not strokes.** A contact that never gets 0.006 box from where it landed (its *reach*, not
  its path length, so a still finger's jitter does not add up) *and* lasts under 150 ms is dropped,
  however it ends. The shortest strokes of the test characters (the dots of 謝) reach 0.06 box, ten
  times that. So a tap moves neither the stroke count, nor the next-stroke badge, nor the Recall alignment. A still
  press held longer and lifted is kept, with its last sample repeated at the lift, so its samples show
  how long it lasted: the stroke check applies the same rule to the ink (to ink from anywhere else
  too) and counts it — as an extra stroke, say — instead of silently ignoring a mark the scorer and
  the badges count. A still contact the app ends (scoring, tab hidden) is dropped, however long it
  was held: a thumb resting on the box while "Chấm điểm" is pressed is no stroke.
- **Pen before touch.** Touch is ignored while a pen is down and for 1.5 s after its last event (down,
  move — hover included — or up): the hand holding the pen rests on the screen. After that, a finger
  writes again (no session-long lock). A pen landing during a touch stroke replaces it.
- **Palms: movement decides, not arrival.** While a touch has not moved 0.02 box from where it landed
  (however long it has rested), a second touch is watched next to it, and whichever of the two first
  moves 0.02 box writes; the other is dropped as a palm. The one that writes keeps the samples it made
  while watched. A still touch that ends while another touch was down during it is dropped too. So a
  palm landing just before *or* just after the finger, or a hand edge resting for seconds, neither
  steals the stroke nor blocks it, and leaves no dot. A touch whose contact is wider or taller than
  80 CSS px is ignored, and a young (under 250 ms), still stroke whose contact grows past that is
  dropped. 80 px, not ~40, because WebKit reports width = 2 × the touch radius: a light iOS fingertip
  is ≈ 42 px. Devices that report no contact size are never rejected.
- **Lost pointerup.** A mouse or pen moving without its primary button (left button, pen tip) ends
  the stroke (`lost`), without the hover samples — also when another button is still held (a
  right-button drag) — but only if its pointerdown reported the primary button, so devices that report
  none still write. The same mouse, or a pen, pressing down again during its own stroke ends that
  stroke (`lost`) and starts a new one, instead of joining the two with a line.
- **End reasons** (`Stroke.end`): `up` (lifted), `cancel` (the browser took the pointer, e.g. an edge
  swipe — the ink is kept, maybe cut short), `lost` (no lift seen), `interrupted` (the app ended it:
  scoring, input disabled, tab hidden). In the review a `cancel`/`interrupted` stroke that did not come
  out right is flagged "Nét k: bị ngắt giữa chừng".
- **Edges.** On touch screens (`pointer: coarse`) the box keeps 28 px (plus safe-area insets) from the
  left and right screen edges, outside the usual back-swipe zones; mouse keeps 16 px.

The debug HUD shows how the last contact ended and how many were dropped (taps, palms, resets).

## Practice flow

The flow is a pure reducer, `src/workspace/attempt.ts` (every transition unit-tested), that the
workspace (`PracticeWorkspace`) renders and drives the engine from. The workspace practises one item at
a time, handed in from outside: a session card, or free practice of one character. A new item (the
session's next card) starts afresh in the same workspace, reusing its engine and canvases.

- **Attempts.** An attempt is one go at one character in one mode. Every navigation — the next
  item, another mode, "Viết lại", **the tab already active tapped again once the attempt is
  scored** — starts a new attempt, and the workspace resets the box whenever `attemptId` changes. So
  ink, verdict colors and results never outlive their attempt. The active tab tapped (or pressed with
  Enter/Space) while the attempt is still being written or scored does nothing: a reset cannot be
  undone, so it must not wipe a half-written character. "Xem" tapped again keeps the stroke-order
  playback where it is.
- **Phases:** `writing` → `scoring` (async) → `scored` → `revealed` (Recall). The box takes input only
  while writing. Scoring calls `flushInput()` then `getInk()`, colors the strokes for that ink's
  revision only, and an answer that comes back for an older attempt is dropped.
- **Recall lock.** Once Recall has shown the answer, tapping "Nhớ lại" again does nothing (a toast says
  why): the learner rates, or leaves. Leaving to Xem / Tô theo and coming back is allowed, but until
  the character is rated the prompt then says "bạn vừa xem mẫu" and the rating is logged with
  `peeked`. So is a review's "Không nhớ?". A rating right after a clean recall is not peeked. The Recall prompt names the script to write ("Viết chữ
  giản thể / phồn thể / này từ trí nhớ"), hides the Âm Hán Việt and masks the character in the
  meaning and the context word ("＿生 · học sinh"). The box's accessible name is "Ô viết chữ" —
  without the character — until the answer is shown.
- **Rating.** Sai / Gần đúng / Đúng after Recall. In a session it is the FSRS grade (see
  [Review deck](#review-deck-sổ-ôn-tập-fsrs-and-sessions)) and the next card follows; in free practice
  it is not recorded, and the character starts over in Xem.
- **Double taps.** While writing, "Chấm điểm" sits above Undo / Clear; the result panel puts its buttons
  at the bottom, so a second tap lands on its text. The panel's buttons also ignore input for 500 ms
  (`inert`, with a `pointer-events` fallback) while they fade in, again when "Hiện mẫu" swaps in the
  rating; with reduced motion they are dimmed instead of fading. The primary button ("Tô theo chữ mẫu
  →" after a rating) ignores taps for 500 ms after a dock button replaced it, and is dimmed meanwhile.
- **Focus and announcements.** After scoring, focus moves to the result heading, which names the
  result region and is described by every issue line: screen readers hear a result once, as it takes
  focus — the count-up is never read out. After a rating or a panel button, focus moves to the prompt
  (also whenever it would otherwise fall to `<body>`). One persistent live region carries the toasts
  (the Recall lock, a scoring failure, the rating), which nothing else conveys.
- **Layout.** The area under the box is at least 200 px and grows with its content up to
  max(200 px, 46svh) in portrait, so the result never covers the box and the box does not resize when
  the result appears; beyond that only the details list scrolls, with a shade at the edge it continues
  past. "+N lỗi khác" / "Chi tiết" expands every issue and the component bars; in short landscape the
  prompt then keeps only its first line, whole, rather than being clipped through a line of text.

**Headline rule** (`resultText.ts`). The score measures shape only — five strokes of 永 all written
backwards trace the same shape and score 98. With stroke data the number is captioned "điểm hình
dáng", the headline adds "N/M nét đúng" and the counts, and the verdict is the **lower** of the
score's grade and the strokes' grade: all strokes good → Rất tốt; some off (misplaced, short, long, in
two pieces, joined) but nothing wrong → at most Khá tốt; any wrong, missing or extra → at most Cần
luyện thêm, and Thử lại when that is more than half the character. The number's color and the box
pulse follow the verdict, so a green pulse never comes with a stroke problem. When the score, not
the strokes, holds the verdict down (every stroke may be right), the scorer's own lines ("Khá ổn, thử
chú ý hơn đến vị trí và độ dài nét.") are listed with the stroke issues, so a lowered verdict always
comes with a reason; "Đúng thứ tự, đúng chiều." shows only when there is nothing else to say.

**Errors.** An `ErrorBoundary` around each screen (and one at the top) replaces a blank page with "Đã
xảy ra lỗi" + "Tải lại"; it, uncaught errors and unhandled rejections are logged with the build (mode +
hashed entry chunk). When no
2D canvas is available (iOS canvas memory) the box itself says so while the rest of the app works. A
scoring failure shows a toast and returns to writing.

## Stroke-order guide

In Observe (**Xem**) the character writes itself stroke by stroke in standard order, slowly, on a loop:
empty box → one stroke at a time with a short pause between → whole character held → again. The same
data draws the faint reference in Trace and the reveal in Recall, and is what scoring measures against —
what the learner watches, traces and is scored on is one shape.

- **Data.** [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) via `hanzi-writer-data` 2.0.1,
  unmodified: one JSON per character (9,574), with stroke outlines (SVG paths) and medians
  (centerlines in writing direction), copied by `npm run data:build` to `strokes/v2.0.1/<hex>.json`
  next to the app. License: see License above.
- **One transform.** `src/strokes/transform.ts` is the only mapping from dataset coordinates (1024-unit
  em square, y up) to the box, at the size and centering the font reference used. The SVG glyph, the
  animation, the scorer's raster, the stroke check and the e2e tests' tracing all go through it.
- **Drawing** (`StrokeOrderView`). The whole character as faint ghost outlines; over it, per stroke, a
  wide round-capped line along the median, clipped to that stroke's outline and revealed with
  `stroke-dashoffset`. Width 200 dataset units (radius 100): no outline of the test characters is
  farther than 84 from its median (measured by `medianPath.test.ts` over every fixture file), and
  200 is the width hanzi-writer uses over the whole Make Me a Hanzi set. The stroke being drawn is in
  the accent color, finished ones in ink; strokes not yet started are hidden, since a
  zero-length dash still paints a round-cap dot.
- **Timing** (`timeline.ts`, pure functions of the loop time). Constant brush speed along the median,
  clamped per stroke so dots stay visible and long strokes don't drag, plus a lead-in, gaps and a final
  hold. Pace **Chậm** (default) or **Vừa**; one loop takes 11.0 / 5.5 s for 永 up to 25.4 / 12.3 s
  for 謝. Switching pace keeps the position.
- **Playback** (`StrokeAnimator`, plain TypeScript like the engine, with an injectable clock). The rAF
  loop runs only while playing in Observe; per frame its only DOM write is the active stroke's dash
  offset. `StrokeControls` is the only React subscriber (≈ once per stroke). A frame advances at most
  100 ms, so after a background tab or a long jank it resumes instead of skipping strokes.
- **Controls** (in Observe, in place of Undo/Clear): **Nét k/N** and the **Chậm / Vừa** switch above
  four buttons — ↺ replay, ‹ previous stroke, ⏯ play/pause, › next stroke. Entering Observe or changing
  character plays from the empty box — unless the learner paused last time: the pause carries over and
  the next character rests on the whole character. Tapping "Xem" while in Observe changes nothing. › draws the next stroke from its start, then pauses;
  ‹ removes the last one; while paused, the stroke named in **Nét k/N** stays in the accent color. Play
  from the whole character starts over. At the end of each loop the character fades out (300 ms) instead
  of cutting to an empty box. ‹ and › use `aria-disabled` at the ends so they keep keyboard focus; steps
  are announced to screen readers, autoplay is not.
- **Reduced motion.** No sweep and no fades: each stroke appears whole at its turn. A character starts
  paused on the whole character until the learner presses play. The setting is followed live.
- **Fetched per character** (`src/strokes/strokeData.ts`). The manifest (asked of the server every
  time: one cached from before a deploy would name a list the site no longer has) points to the
  availability list, which says which characters have a file: once it is in, a character without one
  costs no request and gets a clear "none". The first file does not wait for the list: both are
  fetched side by side, and a 404 is "none". A list the manifest names but the site lacks is an error,
  not "no strokes". Files are fetched with `fetch()`, at most 15 s per attempt, and retries (0.5 / 1 /
  2 s on network and 5xx errors and attempts that time out), never a dynamic `import()`: browsers keep
  a failed import for the life of the page, so it could never be retried. Results are cached in
  memory; a failure is not, so "Thử lại" fetches again. While a file loads, the box shows a spinner
  (after 150 ms) and Xem's controls wait. A character without data uses the font glyph, static, and
  Xem says "Chưa có dữ liệu nét cho chữ này". A failed download says "Không tải được thứ tự nét. Thử
  lại". Scoring waits for the file up to 8 s; if it does not come, it scores against the font glyph
  (the file serves the next attempt once in). A session loads the next card's file while the current
  one is written.
- **Stroke numbers in Trace** (`StrokeNumbers`, placement in `strokeLabels.ts`). A small numbered badge
  sits just before where each stroke starts — "behind" the start, opposite the writing direction —
  under the learner's ink. Placement is pure and cached per character: candidates on rings around the
  start, rejected if they leave the box or touch another badge, ranked by distance, turn away from
  "behind", overlap with the reference's ink (the scorer's outline raster + distance transform) and
  sitting nearer another stroke's start. Tested on every test character: no two badges touch, each
  is nearer its own start than any other, none is centered on ink. While writing, the next stroke to
  write (one past the strokes on the canvas) is in the accent color and written ones fade; it counts
  committed pen lifts — a tap is never one, but a stroke written in two pieces moves the highlight by
  two — and Undo moves it back. Not shown in Recall while writing.

## Stroke-by-stroke review

After "Chấm điểm" in Trace and Recall, `src/strokes/strokeCheck.ts` (pure) says which reference strokes
the learner got right, a bit off, or wrong, which are missing, and what each of the learner's strokes
was taken for. `checkStrokes(ink, data, mode)` returns `user[]` (one entry per learner stroke, in
writing order: verdict, issue, the reference stroke it was matched to) and `reference[]` (one per
reference stroke: verdict or `missing`, issue, the learner strokes matched to it).

- **Alignment, not pairing by index.** The learner's strokes are aligned with the reference's in
  writing order, like an edit distance (dynamic programming over costs): a learner stroke matches a
  reference stroke or is extra; a reference stroke is matched or missing; two consecutive learner
  strokes may make one reference stroke (**split**, "viết thành 2 nét"), and one learner stroke may cover
  two consecutive reference strokes (**merged**, "viết liền thành 1 nét") — each claimed only when it is
  plain. So a forgotten stroke is named alone ("Nét 11: thiếu") instead of shifting everything after it,
  a 横折 written in two pieces does not cascade, and a forgotten first stroke does not turn the rest red.
- **Order.** Strokes left over on both sides (an extra learner stroke and a missing reference stroke)
  that fit each other were written out of order ("sai thứ tự"); for two neighbours swapped, the one it
  jumped over is marked too. A stroke written last marks only that one. The alignment may also have
  taken a stroke written out of order for a neighbour it does not look like ("chưa đúng nét": cheaper
  than an extra plus a missing stroke), so such strokes are candidates too, and the strokes they were
  taken for are open to the others; two strokes each taken for the other's place are swapped back. So
  two swaps at once, or a stroke written two places early, come out as "sai thứ tự", not as "thiếu" +
  "chưa đúng nét" + "Nét thừa". Near-parallel strokes (言's 3/4, 0.083 box apart) moved toward each
  other come out "lệch vị trí", not out of order.
- **What "good" requires.** Mean distance both ways between the stroke and the reference centerline ≤
  0.035 box in Trace, 0.045 in Recall; reaching both ends of the reference (each end within
  max(15% of its length, 0.03 box), or spanning ≥ 80% of it — so a hook left off, or a whole stroke a
  little ahead of its place, is fine, but one stopped at 60% is "hơi ngắn"); not reversed; and nothing
  more than 0.02 box of it farther than 1.5 × that distance from the reference, which a mean hides:
  a tail or hook added (竖 written as 竖钩) is "hơi dài", a detour "lệch vị trí". A dot or short
  stroke (under 0.12 box) instead needs a mark over its middle, of at least 40% of it and 0.02 box:
  its ends are too close for the end rule to tell half a dot (fine) from a 2 px speck (not).
- **Otherwise.** Reversed (runs backwards along the stroke by ≥ 30% of it; not judged below 0.06 box)
  → wrong. Within 0.075 / 0.09 box and running along the stroke (≥ 70% of samples within 35° of its
  direction) → off: short (spans < 70% of it and is shorter), long (spans > 140% and is longer), or
  else misplaced — a stroke moved sideways off a bent or short one changes the span it projects to,
  not its length. Not running along it, or farther → wrong ("chưa đúng nét"). Beyond 2 × the off
  distance it is no attempt at that stroke at all: extra or missing. Taps are ignored.
- **Recall alignment.** Recall aligns the attempt with the reference from several starts, since the
  attempt's bounding box is the reference's only when the whole character was written: in place; box
  onto box; and, when there are fewer strokes than the character has (written in part — the rest
  forgotten, or not written yet), the attempt as large as fits in the reference's box against each
  of its sides, and the attempt as the character's first strokes (their centroid and spread onto
  those of as many reference strokes). The two cheapest starts are refined — scale + position,
  clamped to 0.6–1.6, fitted on the strokes that came out right, at most twice, each refinement kept
  only if it accounts for the attempt at least as well — and the cheapest result wins. With fewer
  than min(3, max(2, ⌈n/2⌉)) strokes, or ink under 0.1 box, it judges in place — one or two strokes
  say nothing about the character's size; the box starts need at least max(2, ⌈n/2⌉) strokes. The
  faint reference is then drawn onto the learner's character with the inverse transform
  (`referenceToInk`), so what they see agrees with the verdicts.
- **Shown as:** the learner's own strokes recolored by their `user` verdict (green / orange / red,
  `engine.setStrokeColors` for that ink revision); the badges by their `reference` verdict, above the
  ink; missing strokes filled red on the reference; the issue list in stroke order ("Nét 2: ngược
  chiều · Nét 3–4: thiếu · Nét thừa"). With stroke data, Recall shows all this right away (no separate
  "Hiện mẫu" step), then asks for the self-rating.
- **Speed** (node on a desktop, median of runs; one synchronous call after "Chấm điểm", not while
  writing). 謝 written with dense, jittery samples (every 0.003 box, 0.003 jitter): ≈ 3 ms in Trace,
  ≈ 7 ms in Recall; written in part and small ≈ 2 / 14 ms; drawn twice over (34 strokes) ≈ 6 / 18 ms;
  a 30-stroke scribble of 6 000 points ≈ 20 / 90 ms. A low-end phone is several times slower.
  `scoreGeometry` costs about as much again.
- **Evidence.** Thresholds come from synthetic ink (`strokeCheck.test.ts`: faithful, wobbly, shifted,
  smaller, reversed, swapped, missing, extra, short, split, joined, taps, tails and hooks added, dots,
  a seeded sloppy-handwriting sweep over all five characters in both modes; in Recall, the character
  written in part at 60–90% size in nine places in the box, two strokes forgotten, every pair of
  independent adjacent swaps and every stroke moved two places), not yet from real learners.

**Characters.** Every character in hanzi-writer-data can be practised (`#/luyen/<hex>`) and carded;
nothing is added by hand. The five characters in `src/test/fixtures/strokes/` (永 你 学 國 謝) are
what the unit tests measure the thresholds on; adding one there (and to `TEST_CHARS`) puts it in the
character-wide tests.

## Scoring (heuristic prototype)

"Chấm điểm" in Trace and Recall gives a 0–100 **feedback score from stroke geometry**. It is not
character recognition, not ML, and not a measure of correctness — the stroke-by-stroke review and the
headline rule above cover order, direction and missing strokes.

```
UI ── HandwritingScorer (interface, async) ── GeometryScorer               (today)
                                          └─ MLHandwritingScorer          (later, same interface)
   ── ReferenceProvider (interface) ──────── StrokeDataReferenceProvider  (today: the character's stroke outlines)
                                              └─ GlyphReferenceProvider   (fallback: device font glyph)
```

Swap implementations in `src/handwriting/scoring/index.ts`; tune weights and tolerances in
`src/handwriting/scoring/config.ts`.

**Reference data today: Partial.** For characters with stroke data (9,574), the stroke
outlines are filled into a 128² mask by `src/strokes/rasterize.ts` (nonzero fill sampled at pixel
centers, the scorer's own raster convention) through the same transform as the on-screen glyph, so
the learner is scored against exactly what they see; the stroke count is the data's. Other characters
fall back to the font glyph:
typeset offscreen with the same font, size and centering as the on-screen reference (not a
screenshot), thresholded into the mask, plus the standard stroke count (Unihan kTotalStrokes).

The medians are **deliberately not** passed as `ReferenceCharacter.strokes` yet: that switches the
scorer to its Full path (a raster of the medians plus per-stroke length comparison), which is not
calibrated and belongs with stroke-order scoring. So the level stays Partial and stroke order is never
part of the number (shown as N/A); the review reports it instead.

An end-to-end alignment test (`StrokeDataReferenceProvider.test.ts`) checks that outlines, medians,
transform and raster agree: ink tracing a character's medians scores ≈ 97–98 in Trace and Recall;
in Trace, the same ink shifted by ±0.06 box on both axes scores ≤ 55 and another character's medians
score ≤ 63.

| Component | How | Trace | Recall |
|---|---|---|---|
| Shape | Oriented matching of ink vs reference centerline (skeleton), both ways → F-score. Direction must agree within 30°; a reference point without direction (a dot, a junction) matches any ink, an ink sample without one (a tap) matches only those. Recall aligns the ink's bounding box to the reference first. | 40% | 50% |
| Position | Symmetric mean distance ink ↔ reference, in place | 35% | 25% |
| Length | Total ink length vs reference centerline length (log ratio) | 15% | 15% |
| Stroke count | \|user − standard\| / standard | 10% | 10% |
| Stroke order | — not scored (see the review) — | 0 | 0 |

Weights are renormalized over the components that could be scored. Without any geometric reference
the scorer returns `insufficient-reference` instead of a number.

Known limitations: on the font fallback the reference depends on the installed font (KaiTi vs YaHei
give slightly different references) and there is no stroke review, so the score alone is the verdict;
the score itself does not see stroke direction (the review and the headline do); ink that happens to
follow the reference structure scores high even if written in the wrong way (e.g. a grid hatched over
國 ≈ 80, measured against the font reference); thresholds are calibrated on synthetic ink, not on real
learners.

## Tests

- **Unit** (`npm test`, Vitest in the node environment, `src/**/*.test.ts` and
  `scripts/**/*.test.mjs`), no network and no generated data needed:
  - handwriting and practice: ink model, input policy, geometry, scorer, stroke check, timeline,
    labels, the practice reducer, result text, prompt masking, practice-item mapping, router, error
    reporting, and the engine and input controller themselves, run against the small DOM stand-ins in
    `src/handwriting/fakeDom.ts` (test-only; the app never imports it). The stroke tests use the five
    fixture characters in `src/test/fixtures/` (loader `strokes.ts`, `TEST_CHARS`);
  - stroke data at run time: the stroke source against a fake `fetch` (cache, none, no data, the
    dev server's HTML fallback, retries, no caching of failures);
  - dictionary (`src/dict`): pinyin display and query parsing, Vietnamese folding, sense parsing and
    links (a reference that is no entry key is no link); the search index on a 392-row slice of the
    real data with golden queries (学生, 學生, xuesheng, xue2sheng1, xuéshēng, hoc sinh, học sinh,
    cảm ơn, "an" grouped, ăn, hành, 行, 了, lv4 / lü4 / lu:4, xi'an, …), query cleaning and gloss
    narrowing; which row stands for a character in a word (`mainForm`); the engine with a fake network
    (core first, retries, checksums, a failed rest, stalls of shards and of the manifest, the stroke
    list not holding up the core, snapshot and warm start, offline start, stale searches); the client;
    the IndexedDB snapshot store (fake-indexeddb);
  - deck (`src/deck`): the store (fake-indexeddb), the deck (add / skipped / existing, grade from the
    rating only, replay equals the stored state even with a clock set back or a device ahead, new
    cards per day across 04:00, HSK cursor saved only after the add, context words, a missing list or
    a network failure, export / import round trip and merge, removals that survive a merge, forged
    files and times, a database upgraded by another tab), the scheduler with a fixed clock, the
    session reducer, due texts; the back-link history (`src/app/history`);
  - data scripts (`scripts/dict/test`): pinyin, CC-CEDICT parsing, the join passes, Hán Việt on the
    gold set and the character table, flags and rank, the row format round trip, senses and
    classifiers, HSK matching, the lock and notices, the order of slang senses in curated rows — on
    small fixtures; and the golden search queries on the built dictionary, once it is built.
- **E2E** (`npm run test:e2e`, `e2e/*.spec.ts`, Playwright on the installed Google Chrome — channel
  `chrome`, nothing to download): the production build **with the real data** (`data:ensure` runs
  first), on a touch phone in two projects, portrait 390×844 and landscape 844×390. Every test starts
  with an empty profile (empty deck, dictionary downloaded and indexed afresh). Every test also fails
  on any console error or uncaught exception, except the ones a test declares it provokes
  (`test.use({ expectedErrors })`). `e2e/fixtures.ts` traces a character's medians (read from
  `public/strokes/`, the files the app fetches) through the app's own transform, by mouse or by
  finger. Covered:
  - `smoke`: home is Hôm nay with the bottom navigation; free practice of 永 loads on Xem with its
    reading (yǒng · vĩnh) and meaning; Observe autoplay; Trace scoring of a faithful 永 (5/5 nét đúng);
    Recall write → score → rate, and free practice starts over without recording;
  - `practice`: all strokes reversed is "Thử lại · 0/5 nét đúng"; re-tapping the active tab clears a
    scored attempt but keeps the ink while writing; a tap is not a stroke; Recall's box label hides
    the character until the answer is shown; the answer seen stays noted ("bạn vừa xem mẫu") through
    another tab and back, and tapping Recall again says why nothing happens; a tap on a rating button
    right after "Chấm điểm" lands while the guard holds; reduced motion dims guarded buttons;
  - `input`: writing with a finger (touch events), a hand resting on the box while the finger writes,
    a still press held on the box counted by the review;
  - `layout`: at 320×568 and 568×320 the result never covers the box, its buttons show whole, the page
    does not scroll and the prompt is not clipped through a line;
  - `failures`: no 2D canvas → message in the box, app still usable; an error while mounting → the
    error page;
  - `dictionary`: search by hanzi (both scripts), pinyin (plain, digits, tone marks), Hán Việt and
    meaning, with and without diacritics; "an" grouped; English fallback labelled; no result; Enter
    opens the top hit and back keeps the results. Entry 学生: tone-colored pinyin, listen, Âm Hán
    Việt, source chip, HSK badge, characters with "Luyện viết" (also the traditional form). 米饭
    labelled as curated; 北京 a proper noun; 价 English only; 了 le → liǎo and 行 xíng → háng through
    "Chữ này còn đọc là". Character cards as the word writes them (头发's 发 is 髮 "tóc"; 舞台's 台 is
    no "ông"); 星期天 no proper noun; 巧克力 a loanword; 睡觉 thuỵ giác, marked as AI-curated. "Thêm vào
    sổ ôn tập" adds 学 and 生 with the word as context, and Hôm nay shows 2 new. "Luyện viết" from the
    entry: tracing 学 (8/8 nét đúng), "+ Ôn tập", back to the entry;
  - `deck`: an empty deck's "Thêm 10 chữ HSK 1" (most frequent first: 的 是 一 …, each with its word);
    a session with one new card (米: Xem → Tô theo 6/6 → Nhớ lại with the character hidden → Đúng →
    summary, which takes focus and is announced), still there after a reload; importing a deck file
    with a card due for review (Nhớ lại only, "＿好 · xin chào", "Không nhớ?"), exporting it back
    (every card and review), rating it and seeing it scheduled days ahead;
  - `navigation`: Back returns to the results scrolled and expanded as they were left; in-app back
    links add no history entry (entry → "‹ Tra cứu", practice → "Quay lại"); an entry opened from
    the keyboard takes focus on its headword and names the word in the title; the traditional form's
    practice is a full-size button;
  - `network`: a stroke file that never arrives still gets a score (font glyph); a failed data list on
    the first visit offers a retry and the HSK quick-add comes back; a missing manifest says so to the
    learner with a working "Thử lại"; with no IndexedDB, "+ Ôn tập" says why it cannot add;
  - `info`: tapping the pinyin opens "Pinyin cho người Việt", whose parts fold (tones open) and whose
    contents open and jump within the page, with no Vietnamese-letter spelling of a Mandarin syllable;
    the credits page lists every source, and every license file, notice and TSV it links to is in
    the build.

  Selectors are roles and visible text, except `.hw-box` (geometry), the badges' `data-state` (they
  are `aria-hidden`), the result's layout classes and a few dictionary and deck classes that have no
  role (a hit's headword, the today counts).

## What desktop testing can validate

- Architecture: React isolation (HUD → `commits during last stroke: 0`), engine/React boundary
- Input pipeline: pointer capture, single active pointer, coalesced events support, right-click ignored,
  taps dropped, lost pointerup (HUD `ended` / `dropped`)
- Rendering: renderer A vs B switching, stroke width, predicted events toggle, high-DPI crispness at
  different browser zoom levels
- Undo / Clear / Undo-after-Clear, mode transitions, Recall → review → rating flow, Recall lock
- Stroke-order playback: order, pace, stepping, looping; reduced motion via DevTools rendering emulation
- Resize behavior: resize the window or zoom the browser — ink keeps its geometry
- Performance instrumentation: per-frame draw cost, JS-side input→draw delay, long-session stability
- Layout sanity with DevTools device emulation (portrait + landscape)
- Dictionary search, entries, the deck, sessions, export / import, persistence over a reload (e2e)

## What desktop testing cannot validate

- Real finger comfort, stroke width feel, finger occlusion on a physical screen size
- Actual touchscreen latency (the HUD's `in→draw` is JS-side only; it excludes compositor and display)
- Mobile browser gesture conflicts: edge-swipe back, pull-to-refresh, toolbar show/hide, system gestures
- Real stylus behavior (pressure curves, hover, barrel buttons) and palm rejection: the 80 px contact
  limit, the 1.5 s pen grace period and the 0.02 box touch takeover are reasoned, not measured (the
  e2e tests drive them with synthetic touch events)
- Coalesced sampling rates of real digitizers (120–240 Hz touch panels)
- iOS Safari specifics (canvas memory limits, `inert` support, tapped buttons not taking focus)
- Screen readers (VoiceOver, TalkBack) on the result announcement and focus moves
- Dictionary load time and memory on a phone (only a 4× CPU-throttled stand-in is measured), IndexedDB
  eviction on iOS, which Mandarin voices phones have

DevTools touch emulation is **not** a substitute: it dispatches synthetic events at whatever rate the
tool sends them. Nothing in this list is validated until it has been tried on a real device.

## Testing on a real phone (later checkpoint)

1. Easiest: open the deployed GitHub Pages URL on the phone (HTTPS, nothing else to set up).
   For local builds: `npm run dev -- --host` and open the printed `Network:` URL on the same Wi-Fi.
2. **Secure context caveat (local only):** `getCoalescedEvents()` / `getPredictedEvents()` are secure-context only.
   Over plain `http://192.168.x.x` they are unavailable (HUD shows `coalesced ✗`) and strokes get fewer
   samples. For a representative test on Android use USB port forwarding so the phone loads
   `http://localhost:5173` (a secure context): enable USB debugging, open `chrome://inspect` on the
   desktop → *Port forwarding* → `5173 → localhost:5173`. This also gives you remote DevTools
   (Performance panel) for the phone.
3. Checklist — none of these has been tried on a real device yet:
   - [ ] 30 strokes in a row: no page scroll, zoom, text selection, context menu or callout
   - [ ] Fast flicks: strokes never break into segments; HUD shows `samples/ev > 1` (coalescing works)
   - [ ] Quick short dots (点) are kept, never dropped as taps; a deliberate tap never becomes a stroke
   - [ ] Palm: resting the hand while writing with a finger or stylus leaves no stray strokes, whether it
         lands before or after the finger; a normal fingertip is never rejected as a palm (HUD
         `dropped`; check the 80 px limit on iPhone and Android)
   - [ ] Stylus: touch is blocked while writing with the pen and works again ≈ 1.5 s after putting it down
   - [ ] Edge swipes near the box edges don't trigger browser back (28 px gutter); a stroke cut by the
         system is flagged "bị ngắt giữa chừng" (HUD `ended cancel`)
   - [ ] Rotate portrait ↔ landscape mid-session: ink keeps its shape and position
   - [ ] App to background → foreground: ink is still there
   - [ ] HUD `commits during last stroke: 0` after every stroke
   - [ ] Performance panel: no long tasks > 16 ms while writing continuously for 30 s
   - [ ] "Chấm điểm" (≈ 80 px below the box in portrait) is not hit by accident while writing near the
         bottom of the box; a quick double tap on it never rates or moves on
   - [ ] Small phones (≤ 375×667) and short landscape: the result never covers the box; "Tự đánh giá" and
         the rating buttons always show whole; "+N lỗi khác" opens the full list
   - [ ] Landscape at DPR 2 (e.g. 568×320): scoring and mode switches never freeze the page (a raw-CDP
         headless Chrome run with `--disable-gpu` sometimes stalled there; the Playwright setup CI uses
         did not, in 4 × 5 runs on this build and the previous one; cause unknown)
   - [ ] iOS: after many characters the box never goes blank; if canvas memory runs out, the box shows
         "Không vẽ được trong ô viết"
   - [ ] VoiceOver / TalkBack: one announcement per result; focus lands on the result, then on the prompt
   - [ ] Renderer A vs B: rate the feel 1–5 on 永 你 学 國 謝 with a finger (and a stylus if available)
   - [ ] Tra cứu on a mid-range Android and an iPhone: time until the first result on a cold start
         (target ≤ 3 s after download), typing stays smooth while the rest loads, warm start on the
         next visit
   - [ ] The listen button: which phones have a Mandarin voice; the hint when there is none
   - [ ] Sổ ôn tập survives closing the browser for a week (iOS storage eviction); export / import between
         two devices
   - [ ] A whole session with a finger: Xem → Tô theo → Nhớ lại → rating, "Không nhớ?", "Dừng buổi ôn"
         (the native dialog on iOS 15.4+), the bottom nav with safe-area insets

## Project layout

```
src/
  main.tsx              global error handlers, top-level ErrorBoundary, <App>
  styles.css            tokens (colors, tone colors, gutters) and shared classes
  app/                  shell — App (screens by route, bottom nav, per-screen error boundary), router
                        (hash routes with params, where a practice returns to), history (back links,
                        scroll and expanded lists per history entry), screen (focus, page title),
                        ErrorBoundary, errorReporting, LiveRegion, ConfirmDialog, viewportLock
  dict/                 Tra cứu (see src/dict/README.md)
    client.ts           `dictionary` (the contract) + useDictStatus; talks to worker.ts by message
    worker.ts, engine.ts    loading (manifest, shards, retries, checksums, snapshot) and requests
    searchIndex.ts      time-sliced index build, search, lookups (pure)
    pinyin.ts           pinyinMarks / pinyinSyllables (also the practice prompt), query parsing
    normalize.ts, senses.ts, row.ts, links.ts, speech.ts
    mainForm.ts         which row stands for a character in a word (entry cards, practice prompts)
    SearchScreen, EntryScreen, PinyinGuideScreen, CreditsScreen, AddToDeck, StrokePreview, ui, dict.css
    screens.ts          the four screens, for the shell
  deck/                 Sổ ôn tập
    api.ts              the app's `deck` (IndexedDB, stroke availability, persist, other tabs)
    DeckErrorNotice.tsx a deck failure for the learner ("Tải lại trang" when another tab upgraded it)
    deck.ts             add / review / today / HSK / settings / export / import over a ProgressStore
    store.ts            IndexedDB "chinese-notebook": cards, reviews (append-only), meta
    scheduler.ts        FSRS (ts-fsrs): grades, replay, learning days, today's plan (pure)
    session.ts          the session state machine (pure)
    charInfo.ts         dictionary.charInfo cache → the practice item
    TodayScreen, DeckScreen, SessionScreen, PracticeScreen, dueText, hooks, deck.css, screens.ts
  handwriting/          engine — no React except the two React adapters
    types.ts            Point, Stroke (id, startedAt, end), Ink, Op
    coords.ts           client px → normalized box coordinates
    InkModel.ts         strokes + undo history + revision, parseInk (pure)
    inputPolicy.ts      taps, palms, pen priority, lost pointerups (pure)
    InputController.ts  pointer events → samples
    HandwritingEngine.ts
    renderers/          Renderer interface, QuadRenderer (A), FreehandRenderer (B)
    scoring/            HandwritingScorer / GeometryScorer, reference providers (stroke data, font)
    HandwritingCanvas.tsx, useEngineState.ts   React adapters
    fakeDom.ts          test-only DOM stand-ins
  strokes/              stroke-order data → screen and scorer; no React except the view and hook
    transform.ts        the one dataset → box mapping
    strokeData.ts       fetch per character (retry, cache), manifest and availability list
    svgPath.ts, rasterize.ts   outline parsing and fill (scoring reference)
    timeline.ts         loop timing, stepping, pace (pure)
    StrokeAnimator.ts   rAF playback controller
    medianPath.ts, StrokeOrderView.tsx, useStrokeData.ts   SVG view + React hook
    strokeLabels.ts, StrokeNumbers.tsx   stroke-number badges (placement, view)
    strokeCheck.ts      stroke-by-stroke alignment and verdicts after scoring (pure)
  workspace/            the writing workspace
    PracticeWorkspace.tsx   one item at a time (session card or free practice), Controls,
                            StrokeControls, ResultPanel
    attempt.ts          practice flow state machine (pure)
    practiceItem.ts     character + dictionary info + context word → what the prompt shows (pure)
    promptText.ts       prompt, Recall instruction and masking, box label (pure)
    resultText.ts       headline rule, labels, announcement, interruption lines (pure)
    strokeFeedback.ts   stroke check → counts and issue lines (pure)
  debug/                DebugHud (lazy chunk), React commit counters
  test/fixtures/        test-only: 5 stroke files (Arphic PL, with README), their loader, TEST_CHARS
scripts/dict/           the data build (see scripts/dict/README.md): fetch, build, ensure, lib/, tests
data/                   inputs in git: sources/ (CC-CEDICT snapshot), overrides/ (curated, CC BY-SA),
                        golden/, licenses/, build-report.json
public/                 generated by data:build, gitignored: dict/v1/, strokes/v2.0.1/, licenses/
e2e/                    Playwright tests (fixtures.ts: tracing by mouse or touch, score reading, URLs)
.github/workflows/ci.yml   data build, checks, e2e on every branch; deploy main after every check passed
```

## Known limitations

- **Phones are unmeasured.** The dictionary numbers above come from a desktop, and 4× CPU throttling
  of the engine on the main thread stands in for a mid-range phone. At that rate the core takes
  about 3 s to become searchable and everything about 10 s. The worker's heap is about 23 MB after a
  cold load and about 48 MB after a warm start (measured on a desktop). Try one real mid-range
  Android and one iPhone before trusting these numbers.
- **No offline mode** (no service worker in v1). A visit needs the network for the manifest and for
  any stroke file not in the HTTP cache (GitHub Pages sends `max-age=600`). The dictionary index
  itself comes from the IndexedDB snapshot, and the deck lives in IndexedDB.
- **The Vietnamese is mostly machine translation** (CVDICT, flagged "bản dịch máy"). The 1,316
  curated rows (HSK 1–2 words, extra glosses, 25 added HSK entries) are AI drafts awaiting the
  owner's review, as are the 228 curated word readings and 62 character readings. 5,685 entries (386
  in the core) have only English. The single characters of the HSK 1 writing list are not curated as
  characters: a quick-added card leans on its context word's curated meaning.
- **Hán Việt** is about 96% right per word (1 word in 25 needs curation), and 1.4% of all-Han entries
  have no reading. 192 phonetic loanwords are muted (`-`), reviewed from CC-CEDICT's 840 "(loanword)"
  entries — the HSK ones and the common ones; the rest still show a character-by-character reading.
- **HSK tags follow the list's CC-CEDICT keys.** Where the list names a proper-noun homograph in
  capitals (茅台 Máotái, the town row rather than the liquor), the tag stays on it.
- **Sessions live in memory.** A reload or the browser's Back during a session starts a new one from
  the deck (every rating was already saved). The first session after opening the app may show "…" as
  the prompt until the dictionary's core has loaded. A card with no context word gives no clue in
  Nhớ lại if the dictionary cannot load at all.
- **Only writing cards.** v1 has no reading or meaning cards. Removing a card keeps its reviews in the
  log, and a card added again starts afresh.
- **Listening needs a Mandarin voice on the device.** Many Vietnamese Windows PCs have none, and Chrome's
  and Edge's own voices need a connection. There is no recorded audio.
- **Storage can be evicted** (iOS especially). `navigator.storage.persist()` is asked once. Export the
  deck to keep a copy.
- The dictionary and deck screens (with ts-fsrs and idb) are in the main bundle: 445 KB, 142 KB
  gzip, up from 313 KB. Lazy-loading the screens was measured (review, 2026-09): it halves the main
  chunk and trims Hôm nay's startup by 0.15–0.25 s, but makes first visits through a deep link
  (`#/luyen/…`, an entry) 0.2–0.6 s slower, since the screen's chunk is fetched only after the main
  one runs — not a clear win, so the screens stay in the main bundle. The worker and the debug HUD
  are already separate chunks; a worker that fails to load (a deploy replaced it) says so with
  "Tải lại trang".
- A Kai (楷) style font is needed for learning handwriting, and the font glyph (characters without
  stroke data, before a stroke file arrives) uses KaiTi when installed, else Song/Hei styles.
  Bundling a licensed Kai font (e.g. LXGW WenKai, OFL-1.1) is a later decision.
- Traditional characters follow the dataset's mainland (PRC) stroke-order conventions, and the entry
  page says so. Taiwan's standard order differs for some characters; this has not been verified
  character by character.
- At hooks and sharp bends the reveal runs ahead of the brush by up to the cap radius (100 units,
  ≈ 8% of the box): the round cap uncovers outline near the brush that the median reaches only later.
- The next-stroke badge counts pen lifts while writing: a stroke written in two pieces moves it by two
  (the review after scoring does recognise the split).
- Recall's alignment is tested on synthetic ink only: in sweeps of several thousand attempts (whole,
  partial, two strokes forgotten, sloppy; 60–100% size anywhere in the box) no misalignment remains,
  but real handwriting may still find cases.
- A group of tightly spaced parallel strokes all written more than ≈ 0.06 box off together (言's
  three horizontals) can be read as each stroke taken for its neighbour, one missing and one extra,
  instead of "lệch vị trí" for each: at that shift each stroke lies nearer its neighbour's place, and
  only its length tells them apart, which the alignment's cost does not weigh.
- The order check does not look at direction: a stroke written both out of order and backwards is
  called "sai thứ tự" only.
- Ink color is fixed; no dark mode.
