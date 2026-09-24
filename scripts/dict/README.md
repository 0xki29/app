# Dictionary data build

Builds the app's Chinese→Vietnamese dictionary, stroke files and license notices from pinned open
data. Everything it writes goes to `public/` (gitignored), which Vite copies into `dist/` as is.

```bash
npm run data:build   # fetch (first time ≈ 74 MB download, cached) + build + gates → public/
npm run data:fetch   # only download / verify the inputs into .cache/dict-src/
npm run data:check   # fetch + every step and gate, writes nothing (for a PR that edits data/)
npm run data:ensure  # data:build only when public/ is missing or older than its inputs (test:e2e runs it)
```

`data:ensure` compares a hash of the inputs kept in git (the lock file, `data/overrides`,
`data/golden`, `data/licenses`, `data/sources`, `build.mjs` and `lib/`) with the stamp the last
build wrote to `.cache/data-build.json` (`lib/stamp.mjs`). It also checks that `public/` still
holds every file of that data version.

Run `npm run data:build` once after cloning: without it the app has no dictionary and no stroke data
(the dictionary screens say so), and `npm run build` warns that it ships without data. The first run
downloads ≈ 74 MB (the wordfreq wheel is 54 MB, of which the build keeps the 1.7 MB Chinese list) and
keeps ≈ 21 MB in `.cache/dict-src/`; later runs download nothing. A build takes ≈ 20 s.

## Inputs (`sources.lock.json`)

| Source | What it gives | Pinned as |
|---|---|---|
| CC-CEDICT 2026-09-23 (CC BY-SA 4.0) | headwords, pinyin, English senses | decompressed snapshot in `data/sources/` (MDBG's URL always serves the latest; text, so a refresh is a small git delta) |
| CVDICT commit c379d909 (CC BY-SA 4.0) | Vietnamese senses (machine translation) | raw.githubusercontent URL at the commit |
| hanviet-pinyin-words 2.1.7 (MIT) | Hán Việt per character and pinyin | npm devDependency |
| Unihan 18.0.0 (Unicode License V3) | fallback Hán Việt (low confidence), kMandarin, kHanyuPinlu, variants | versioned unicode.org URL |
| wordfreq 3.1.1 `large_zh` (CC BY-SA 4.0) | word frequency for the rank | PyPI wheel URL; member extracted |
| ivankra/hsk30 commit 4ff9e391 (MIT) | HSK 3.0 levels, the 1,200-character writing list | raw.githubusercontent URLs at the commit |
| hanzi-writer-data 2.0.1 (Arphic PL) | stroke files, copied byte for byte | npm devDependency (tree checksum) |
| `data/overrides/` (CC BY-SA 4.0) | curated glosses, Hán Việt fixes (word and character), missing HSK words, join and proper-noun corrections | in the repository |

Every download is checked by size and SHA-256 of the bytes received over HTTP (never a git checkout:
a Windows clone adds CRLF). npm inputs are checked against package-lock's integrity and their own
file hashes. Requests carry only the generic User-Agent in the lock file.

**Updating a source:** change its URL/version, `bytes` and `sha256` in the lock (and `expect` if the
entry count moves), run `npm run data:build`, review the diff of `data/build-report.json`, commit.
The CI cache is keyed on the lock file's hash, so it refreshes by itself.

## Pipeline (`build.mjs`, pure steps in `lib/`)

1. **Parse** CC-CEDICT and CVDICT (`lib/cedict.mjs`; CRLF, BOM, one known malformed CVDICT line
   repaired), merge duplicate keys.
2. **Join** CVDICT onto CC-CEDICT (`lib/join.mjs`): exact key; same headword with pinyin equal
   ignoring case; ignoring tones; same simplified form ignoring tones; then main/variant forms that
   swapped places since CVDICT was made (電視臺 → 電視台). Passes 2–4 only use CVDICT entries whose
   own key no longer exists, and only an unambiguous one, one to one (an entry two rows would take
   goes to neither); `data/overrides/join-deny.tsv` names loose joins known to be another word's
   translation (累 lei2 would get "họ Lei"). Joins that cross proper-noun case are listed in the
   report for review.
3. **Senses** (`lib/senses.mjs`): NFC; Vietnamese gets hoà-style tone marks (hoà, thuỷ, khoẻ);
   classifier notes (CL:, LT:, Lượng từ:, inline or trailing) become one last sense
   `Lượng từ: 个 (gè), 位 (wèi)`; cross-references are resolved to current keys (pinyin written without
   spaces and swapped forms included), and one that resolves to no entry becomes plain text (hanzi,
   plus tone-marked pinyin when it lines up), never a dead link; entries whose senses are all
   cross-references get Vietnamese by template ("used in X" → "dùng trong X"); CVDICT's "phiên âm
   Đài Loan [fa3]" for "Taiwan pr." reads "cách đọc ở Đài Loan [fa3]".
4. **Hán Việt** (`lib/hanviet.mjs`, MEMO §2 without QuickTranslator): from the entry's traditional
   form, per character: the curated character table (`data/overrides/hanviet-char.tsv`: 冷 lãnh, not
   the vernacular lạnh the word list puts first), then the word list's reading for any pinyin, for the exact pinyin, for a hint
   (the gloss's "Taiwan pr.", other readings of the headword, Unihan kMandarin) of the same syllable,
   the union for that toneless syllable; the same on Unihan variants; then, flagged low-confidence,
   Unihan kVietnamese and the list's readings under another pinyin; else nothing (no partial
   readings). Spelling: y after h/k/l/m/t (lý, kỳ, mỹ, ty); every syllable capitalized for proper
   nouns (Bắc Kinh), except the common nouns CC-CEDICT capitalizes (`not-proper-noun.tsv`: 汉语,
   星期天). Alternates change one character at a time (at most 5).
5. **Overrides** (applied last): `vi-gloss.tsv` replaces the Vietnamese, `hanviet-word.tsv` the word
   reading (`-` for a phonetic loanword; alternates after `|` stay searchable; a capital the curator
   writes is kept: Hán ngữ), `extra-entries.tsv` adds HSK words CC-CEDICT lacks. Keys written against
   an older CC-CEDICT are resolved when unambiguous (reported). An empty cell is an error.
6. **HSK 3.0**: each list word's keys (or, without a key, the entry with its reading); a key that is
   now only a variant tags the entry it points to, and a curated gloss or reading written for that
   key follows the tag (複習 → 復習 for 复习). Of two keys of one written form, a row that is only a
   classical sense plus "variant of" the other gives way to it (台 → 臺|台), and a proper-noun row gives
   way to the common word the list writes in lowercase (标致 is "xinh", not Peugeot). Level 7 = 7–9.
   The writing lists are ordered by frequency (the wordfreq frequency of every word containing the
   character, summed; the list's alphabetical order breaks ties: 的 是 一 在 不 人 …) — the list's
   own "Freq" column counts HSK words per character (我 3, 不 207), not use. Each level-1 character
   gets the word it is learned in (`hskContext`: the lowest-level HSK word with it, several characters
   before one, then the most common: 么 → 什么, 汉 → 汉语).
7. **Rank**: HSK words first by level, then everything else; within a group by wordfreq Zipf minus
   penalties (variant-only −3, other cross-reference-only −0.5, proper noun −0.05; wordfreq counts a
   written form, so a single character's other readings get log10 of their kHanyuPinlu share, up to
   −4, or −1.5 when kHanyuPinlu does not list them, and −1.5 goes to a single-character proper noun
   next to the common word and to a row that is a variant of another row of the same form), then
   shorter headwords, then code order.
8. **Gates** (the build writes nothing if one fails): input checksums (and the stroke tree);
   CC-CEDICT and CVDICT entry counts within ±2% of the lock; every line parsed and every line fix
   used; every override key resolves (join-deny and not-proper-noun too); every curated reading has
   the shape of Vietnamese syllables (typos, junk; not a check that it is right); no row ships a
   vernacular form `hanviet-char.tsv` rules out (`hv-vernacular`); no row outside NFC; no row without
   vi and en; on all-Han rows, pinyin syllables = characters and Hán Việt syllables = spoken
   syllables; Hán Việt coverage ≥ 98.5% of all-Han rows; the gold set (`data/golden/hanviet-gold.tsv`,
   46 words): the algorithm alone may miss 2 (conventional readings are the overrides' job), the
   shipped column none; every HSK 3.0 level-1 word has an entry; every HSK 1–2 row carries a curated
   gloss (`hsk12-curated`); every source has a complete notice and a license text that is one (≥ 500
   bytes). After writing, the shards are read back and compared. The golden search queries
   (`data/golden/search-queries.tsv`) run in `npm test` on the shards written.
9. **Emit**: shards + manifest, stroke files + availability list, licenses + notices,
   `data/build-report.json` (committed: counts and sizes, no timings, so data changes show in review).

## Output (the contract the app reads)

`public/dict/v1/manifest.json` (compact JSON):

```jsonc
{ "format": 1, "dataVersion": "20260923-5c8ef450",   // CC-CEDICT date + hash of the content
  "columns": ["simp","trad","pinyin","hv","hvAlt","vi","en","hsk","pop","flags"],
  "rows": 125126, "license": "CC BY-SA 4.0", "notices": "licenses/THIRD_PARTY_NOTICES.md",
  "shards": [{ "file": "core.<hash8>.tsv", "from": 0, "to": 29999, "bytes": 3076639, "sha256": "…" },
             { "file": "rest-1.<hash8>.tsv", "from": 30000, "to": 54999, … }, …],   // 25,000-row rest shards
  "strokes": { "base": "strokes/v2.0.1/", "available": "strokes/v2.0.1/available.<hash8>.txt", "count": 9574 },
  "hskWriting": { "1": [300 chars], "2": [400], "3": [500] },   // the HSK 3.0 writing list, most frequent first
  "hskContext": { "么": ["什麼|什么[shen2 me5]", "gì; cái gì"], "中": ["中國|中国[Zhong1 guo2]", "Trung Quốc", true], … },
                // level-1 characters → the word a quick-added card is learned in: key, first meaning, proper noun
  "flags": ["pn", …],
  "sources": [{ "id", "name", "version", "url", "license", "licenseUrl", "attribution", "notes",
                "changes", "licenseFiles": ["licenses/…"] }] }
```

Shard file names are relative to the manifest; `strokes.*` and `licenseFiles` to the site root.

**Shards:** UTF-8 NFC, rows separated by LF with **no trailing LF** (so `text.split('\n')` gives
exactly the rows), no header; a row's global index (`from` + line number) is its entry number within
this `dataVersion`, and the row order is the rank. Ten tab-separated columns:

| Column | Content |
|---|---|
| simp | simplified headword |
| trad | traditional headword, `''` when the same as simp |
| pinyin | CC-CEDICT numbered pinyin, space-separated (`xue2 sheng5`, `lu:4`, `Bei3 jing1`, `r5`) |
| hv | Âm Hán Việt, syllables space-separated, lowercase except proper nouns (capitalized per syllable) and a curated capital (Hán ngữ); runs of Latin letters/digits kept as one token (`X quang`); `-` = loanword without a meaningful reading (curated only); `''` = unknown |
| hvAlt | other full readings, `\|`-separated (one character changed each), or `''` |
| vi | Vietnamese senses, `/`-separated; a classifier sense is always last: `Lượng từ: 个 (gè), 位 (wèi)` |
| en | CC-CEDICT English senses, `/`-separated — only when vi is empty |
| hsk | HSK 3.0 level `1`–`7` (7 = 7–9) or `''` |
| pop | 0–100: 10 × (Zipf − penalties) + HSK bonus (L1 20, L2 17, L3 14, L4 11, L5 8, L6 5, L7–9 2) |
| flags | `,`-separated, in this order: `pn` proper noun · `var` variant-only · `usedin` "used in"/"see" only · `mt` vi from CVDICT (bản dịch máy) · `cur-ai` vi curated by AI, awaiting review · `cur` vi reviewed · `en` English shown · `hvlow` a low-confidence Hán Việt syllable (another pinyin's reading, or Unihan) · `hvnom` …from Unihan kVietnamese (may be a Nôm reading) · `hvcur-ai` Hán Việt set by curation (word or character table), awaiting review · `hvcur` …reviewed · `nostroke` a character (simplified or traditional) has no stroke file · `added` an entry CC-CEDICT lacks (extra-entries.tsv) |

The stable entry key is `trad|simp[pinyin]` (trad reconstructed from simp when the column is empty).
Cross-references inside senses use CC-CEDICT notation resolved to current keys: `trad|simp[py]`, or
`simp[py]` when both forms are the same (so `了[liao3]` is the key `了|了[liao3]`). References that did
not resolve to exactly one entry are left as written.

`public/strokes/v2.0.1/<lowercase hex>.json` — hanzi-writer-data files, byte for byte;
`available.<hash8>.txt` — every character with a file, concatenated in code-point order, no separator;
`ARPHICPL.TXT` and `README.md` beside them.

`public/licenses/` — CC-BY-SA-4.0.txt, Unicode-License-V3.txt, MIT-hanviet-pinyin-words.txt,
MIT-hsk30.txt, ARPHICPL.TXT and THIRD_PARTY_NOTICES.md (generated from the lock: attribution, license,
changes and exact input of every source). `vite.config.ts` fails a build that has data but not these.

## Curating (`data/overrides/`)

Tab-separated, `#` comments, a header row; keys in CC-CEDICT form. `status` is `ai-draft` (shown as
"hiệu đính bởi AI, chờ duyệt", flag `cur-ai`; a reading as "AI đề xuất, chờ duyệt", flag `hvcur-ai`)
or `reviewed` (shown as "đã hiệu đính", flag `cur` / `hvcur`) — only the owner sets `reviewed`. A
character read wrongly everywhere is fixed once in `hanviet-char.tsv` (with its vernacular form, which
the gate then keeps out), not word by word. Log changes in `data/overrides/CHANGELOG.md`, then
`npm run data:check`.

## Tests

`npm test` runs `scripts/dict/test/*.test.mjs` (pinyin, CC-CEDICT parsing, the join passes and the
deny list, Hán Việt on the gold set and the character table, flags and rank, the row format round
trip, senses and references, HSK matching and key refinement, the lock and notices, Vietnamese
syllable shape) on small fixtures in `test/fixtures/` — no network, no cache — and, once
`npm run data:build` has run, the golden search queries on the shards in `public/`
(`golden-search.test.mjs`; skipped without them). `test/make-fixtures.mjs` regenerates the fixtures
from the real inputs.
