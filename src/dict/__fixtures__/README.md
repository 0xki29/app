# Dictionary test fixture

A 392-row slice of the generated dictionary (`npm run data:build`, data version 20260923-5c8ef450,
the format of `public/dict/v1`: see `src/dict/README.md`), used by the unit tests of the search
index, the worker engine and the client: `core.tsv` (rows 0–273) and `rest-1.tsv` (rows 274–391) as two shards, `manifest.json` with
their sizes and SHA-256, and `available.txt` (characters "with stroke data": every character of the
rows except 呣 and 乾, so the "no stroke data" paths are exercised).

Rows were picked for the golden queries (学生, 学习, 你好, 谢谢, 行 xíng/háng/héng, 长, 了, 一个,
an/ăn, hành, nhi, …), plus the most common rows as distractors and a few variant, "used in",
proper-noun, English-fallback and no-stroke rows; they keep their relative order (row order = rank).
The checksums cover the exact bytes: `.gitattributes` here keeps git from changing line endings.
To change a row, edit the TSV and update `bytes` and `sha256` in `manifest.json`.

## License

The rows are derived from **CC-CEDICT** (MDBG; CEDICT © 1997, 1998 Paul Andrew Denisowski) and
**CVDICT** (Phong Phan), both under the Creative Commons Attribution-ShareAlike 4.0 license
(https://creativecommons.org/licenses/by-sa/4.0/), with Hán Việt readings from
**hanviet-pinyin-words** (© 2024 Phong Phan, MIT), HSK 3.0 levels from **ivankra/hsk30**
(© 2023 Ivan Krasilnikov, © 2021 Shawky, © 2021 Pleco Inc., MIT), popularity from **wordfreq**
(Robyn Speer, CC BY-SA 4.0) and Vietnamese glosses drafted for this project (CC BY-SA 4.0). This
fixture is therefore distributed under **CC BY-SA 4.0**. Changes: rows selected, merged and
re-ordered, Hán Việt, levels and a popularity score added, some glosses rewritten.
