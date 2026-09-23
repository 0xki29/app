# Stroke-order data

One file per character, named by its Unicode code point in lowercase hex (`5b66.json` = 学).
Loaded lazily by `src/strokes/strokeData.ts`.

- **Source:** [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0.1, unmodified,
  which is derived from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) (`graphics.txt`).
- **Format:** `strokes` = stroke outlines as SVG path data, `medians` = stroke centerlines in writing
  direction, `radStrokes` = radical stroke indices. Coordinates: 1024-unit em square, y up, top of the
  em square at y = 900 (see `src/strokes/transform.ts`).
- **License:** the glyph data derives from fonts by Arphic Technology and is distributed under the
  **Arphic Public License** — see [ARPHICPL.TXT](ARPHICPL.TXT). This license covers these data files
  only, not the app's source code. Keep the files and this notice together when redistributing.
- **Known limitation:** the dataset was built around mainland (PRC) conventions. For traditional
  characters, Taiwan's standard stroke order differs for some characters; this has not been checked
  character by character.

To add a character, copy `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json` here under
its code-point name.
