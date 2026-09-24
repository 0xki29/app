# Stroke-order data (test fixtures)

Five characters (永 你 学 國 謝), one file per character, named by its Unicode code point in lowercase
hex (`5b66.json` = 学). The unit tests read them through `src/test/fixtures/strokes.ts`, and the e2e
tests (`e2e/fixtures.ts`) trace their medians. The app itself never bundles them: it fetches the full
set at run time from `strokes/v2.0.1/<hex>.json`, which `npm run data:build` copies into `public/`
from the same package (see `src/strokes/strokeData.ts`).

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

To add a fixture, copy `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json` here under
its code-point name, and add the character to `../testChars.ts` if the character-wide tests should
cover it.
