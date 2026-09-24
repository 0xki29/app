# Test fixtures for the dictionary build

Small excerpts of the real inputs, so the unit tests run without the network or the download cache.
Regenerate with `node scripts/dict/test/make-fixtures.mjs` (after `npm run data:fetch`).

- `gold-cedict.u8` — the CC-CEDICT lines (2026-09-23 export) of the gold-set words (data/golden/hanviet-gold.tsv).
  CC-CEDICT, published by MDBG; CEDICT © 1997, 1998 Paul Andrew Denisowski. CC BY-SA 4.0.
- `gold-unihan.txt` — Unihan 18.0.0 fields (kVietnamese, kMandarin, kHanyuPinlu, variants) of
  their characters. © 1991-2026 Unicode, Inc., Unicode License V3 (data/licenses/Unicode-License-V3.txt).
