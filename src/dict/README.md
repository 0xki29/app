# Dictionary (Tra cứu)

Chinese → Vietnamese dictionary of 125k entries: search by hanzi (simplified or traditional),
pinyin (tone marks, digits or none), Âm Hán Việt and Vietnamese meaning; entry pages with
tone-colored pinyin, a listen button, Hán Việt, meanings with their source, the word's characters
(stroke-order preview, "Luyện viết") and "Thêm vào sổ ôn tập". Data: `npm run data:build` (see the
data sources and licenses in the app's "Giới thiệu & nguồn dữ liệu" page).

```
screens.ts        DictionarySearchScreen (#/tra-cuu[?q=]) · EntryScreen({ entryKey }) (#/tu/<encodeURIComponent(key)>)
                  PinyinGuideScreen (#/pinyin) · CreditsScreen (#/nguon-du-lieu); each imports dict.css
client.ts         `dictionary` (the contract below), useDictStatus(); talks to the worker by message
worker.ts         the module worker: DictEngine + IndexedDB + crypto.subtle + fetch
engine.ts         loading (manifest, shards, retries, checksums, core first, snapshot) and requests (pure env)
searchIndex.ts    IndexBuilder / DictIndex: building (time-sliced), search, lookups, snapshot parts (pure)
pinyin.ts         pinyinMarks / pinyinSyllables (display), parsePinyinQuery / pinyinMatch (search) (pure)
normalize.ts      Vietnamese folding: diacritics, đ → d, i/y (kỳ = kì), tone keys (hoà = hòa) (pure)
senses.ts         a sense → text / notes / hanzi / cross-reference links; first meaning for lists (pure)
row.ts            TSV row ↔ DictEntry, entry keys, flag bits (pure)
mainForm.ts       which row of a character stands for it in a word: the word's traditional form, its
                  reading there, never a classical row that only points to another form (pure)
speech.ts         Web Speech: pick a Mandarin voice (zh-CN first, never Cantonese), speak
links.ts          routes, back links, prefilled "Báo lỗi" GitHub issue (no personal data)
ui.tsx            PinyinText, ListenButton, source chip, SenseView, status notice, top bar
StrokePreview.tsx small stroke-order animation (StrokeOrderView + StrokeAnimator), plays only on screen
AddToDeck.tsx     one writing card per character with stroke data, the word as context (deck.add)
```

## Contract (`client.ts`)

```ts
dictionary.status(): DictStatus            // { state, progress, error?, dataVersion?, loadedBytes?, totalBytes?, building?, fromSnapshot? }
dictionary.subscribe(cb): () => void       // useDictStatus() wraps both for React
dictionary.ensureLoaded(): void            // starts (or retries) loading; search/entry/charInfo/word start it too
dictionary.search(q, limit = 50): Promise<SearchResult>
dictionary.entry(key): Promise<DictEntry | null>      // lenient: a key from an older data version still finds its entry
dictionary.charInfo(ch): Promise<CharInfo | null>     // + counterparts[] and partial (extra, optional to use)
dictionary.hskWriting(level: 1 | 2 | 3): Promise<string[]>   // manifest only: no entries downloaded
dictionary.hasStrokes(ch): Promise<boolean>                 // manifest + stroke list only; rejects if the list is unavailable
dictionary.word(key): Promise<WordDetail | null>      // extra: entry + its characters + other readings (the entry screen)
dictionary.meta(): Promise<DictMeta>                  // extra: data version, sources, plain data files (credits page)
```

States: `idle` → `loading-core` → `ready-core` (searchable: the ~30k most common entries) →
`loading-rest` → `ready`; `error` (retry with ensureLoaded), `no-data` (no manifest and no saved copy:
the message says so to the learner, ensureLoaded asks again; on the dev server the screens add "chạy
npm run data:build"). If only the rest fails, the state stays `ready-core` with an `error` text,
ensureLoaded retries from the shard that failed, and an entry only in the rest says it could not be
loaded (not "not found").

`DictEntry.trad` is always the traditional form (equal to `simp` when they do not differ);
`pinyin` stays CC-CEDICT numbered ("xue2 sheng5"; `pinyinMarks` for display).

**SearchResult** `{ query, hits, groups, partial, stale, ms }`:
- `hits`: one per entry, its best match, best first: `{ entry, score, kind: 'hanzi' | 'pinyin' |
  'hanviet' | 'meaning', sense, lang? }` — for a meaning match, `sense` indexes the sense that matched
  (in `entry.vi`, or `entry.en` when `lang` is `'en'`).
- `groups`: for a one-word Latin query that matched in more than one way ("an": pinyin ān/àn, Hán
  Việt an/án, meaning ăn) the hits per kind (≤ 30 each, with `total`), best group first; else `null`.
- `partial`: only the core was searched (the rest is still loading) — the screens search again when
  it arrives. `stale`: a newer search was issued before this one was answered; ignore it (the worker
  also skips searches overtaken while they waited). Debouncing is the screen's (100 ms).

## Search

Rows are in rank order (row id = rank). Score = match tier + popularity (0–100):

| Kind | Tiers |
|---|---|
| hanzi (simp or trad) | exact 1000 · prefix 800 · contains 500 |
| pinyin | exact 900 · prefix 600 at a syllable end / 560 inside one; a neutral tone in the entry takes any typed tone (−20); ü typed as u −20; typed tones that match nothing fall back to toneless 450/300 |
| Hán Việt (primary and alternates) | exact 900 · prefix 600 whole syllables / 560 inside the last one (only from 3 letters or 2 syllables: "an" is not "anh"); typed diacritics: 915/615 when they match, 590/450 when only the folded form does |
| meaning, Vietnamese | a gloss equal to the query 850 · starting with it 700 · containing it 550 · a word starting with it 400 · all words somewhere 300; +10 in the first sense, −15 per later sense (at most −45), +20 Vietnamese, +40/+25 when typed diacritics match, 300 when they do not (mèo ≠ mẹo); a pattern gloss ("người …") is "containing" (550), a gloss a note or a label narrows ("uống (thuốc)", "(miệt thị) Hàn Quốc"; not plain register such as "(khẩu ngữ)") is "starting with" (700); a phrase equal to a gloss +50 (so "xin chao" is 你好 before xīn cháo); a leading classifier is optional ("con lợn" also searches "lợn", −15); the last word of a phrase is expanded from 3 letters |
| meaning, English | only rows with no Vietnamese (flag `en`), their own index, whole words, −300; the screen says so when most hits are English |

Variant-form rows get −150 unless the hanzi match exactly. The query is cleaned first: NFKC
(full-width letters), punctuation, symbols and emoji dropped; with hanzi in it, the text as typed
without spaces, else its Han runs joined (学sheng → 学), else the first run (学生 老师 → 学生). A
group keeps its best 30 and the screen says how to narrow the rest. Typed text is folded: no diacritics,
đ → d, i/y (kỳ = kì, lý = lí, but not thuỷ/thui), and hoà/hòa compare equal when diacritics are
typed. Tone marks, digits, apostrophes and spaces in pinyin are position filters on the entry's
syllables, never a segmentation. Classifier senses ("Lượng từ: …") and pinyin in brackets are not
indexed as meanings; notes in parentheses count as words but not as the gloss.

## Loading and caching

- The worker fetches `dict/v1/manifest.json` with `cache: 'no-cache'` (network first; the copy saved in
  IndexedDB when offline, or when the answer is not the manifest: a 404 mid-deploy, a Wi-Fi login
  page), then the core shard, then the rest — streamed for progress, aborted after 20 s without data,
  retried after 0.5 / 1 / 2 / 4 s (a 404 is not retried), size and SHA-256 checked against the manifest
  (`crypto.subtle`; skipped where it does not exist, e.g. a LAN IP in dev). The manifest and the
  stroke availability list get the same retries and at most 10 s per attempt; the list (named by its
  hash, `force-cache`) is fetched beside the core and only charInfo, word and meta wait for it.
- The index is built in time slices (≤ 12 ms, then the worker yields to queued messages): rows are
  added in steps of 64, and every sort is a merge sort that yields every 20k comparisons. So searches
  are answered while the rest is added; the rest's shards download while the previous one is added.
- Once everything is in, a snapshot of the index (text + typed arrays) is written to IndexedDB
  (`cn-dict`, one piece per transaction, a "complete" record last), keyed by data version + index
  format. The next start reads it instead of downloading and building. No service worker (v1).

## Measurements (real data: 125,126 entries, 5 shards, 13.6 MB, 5.7 MB gzip)

Desktop i5-6400, Chrome headless, production build. **4×** = the same engine on the page's main
thread with CDP `Emulation.setCPUThrottlingRate` 4 — CDP refuses throttling for worker targets
("only supported for pages"), so this is the stand-in for a mid-range phone. Local server: network
time not included (the core is 1.2 MB gzip).

| | 1× (worker) | 4× (throttled) |
|---|---|---|
| core indexed (30k entries) | 0.45 s | 2.3 s |
| searchable after opening Tra cứu (local) | 0.9–1.4 s | 2.7 s |
| everything indexed (added while downloading) | 2.1 s of work, ready at 3.3–3.7 s | 5.9–6.2 s of work, ready at 8.8–9.2 s |
| a search while the rest is being added (round trip) | ≤ 50 ms | ≤ 43 ms |
| warm start from the IndexedDB snapshot | 0.28–0.30 s | 0.59–0.64 s |
| query, median of the hardest ("an", "ăn", "hành", "ma", "một") | 3–6 ms | 12–22 ms |
| query, worst first run | 17 ms | 61 ms ("ăn") |
| hanzi / pinyin queries | < 1.5 ms | < 5 ms |
| worker heap after load / after a warm start | 23 MB / 48 MB | — |

Worker chunk: 32.7 KB (12.1 KB gzip). Real phones have not been measured yet.

## Tests

`npm test`: pinyin, folding, sense parsing and links; the index on a 392-row fixture of the real
data (`__fixtures__`, golden queries: 学生, 學生, xuesheng, xue sheng, xue2sheng1, xuéshēng, xues,
hoc sinh, học sinh, cam on, cảm ơn, an (grouped), ăn, hành, nhi, 行, 长, 了, lv4/lü/lu:4, xi'an, …);
the engine in-process with a fake network (core first, answers during the rest, no-data, HTML
fallback page, retries with backoff, checksum failure and retry, rest failure keeps the core, stall
timeouts of a shard and of the manifest, the stroke list not holding up the core, snapshot save and
warm start, offline start, storage failures, stale searches, meta without entries, charInfo, word
details); `mainForm` (the word's traditional form, the classical 台 row, 汉 in 汉语); the client
(status, stale replies, worker crash); the IndexedDB snapshot store on fake-indexeddb. The golden
queries of `data/golden/search-queries.tsv` run on the whole built dictionary
(`scripts/dict/test/golden-search.test.mjs`).
