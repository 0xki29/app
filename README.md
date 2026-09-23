# Chinese Notebook — handwriting prototype (P1)

A handwriting-first Chinese learning web app. This repository currently contains **only the handwriting
prototype**: one workspace for writing Hanzi with a finger, stylus or mouse, with Observe / Trace / Recall
modes, heuristic scoring and a debug HUD. In Observe the character writes itself in stroke order, from
bundled stroke data that also draws the Trace and Recall references and the scoring reference.
No lessons, persistence, audio, backend or PWA yet — on purpose.

## Run

```bash
npm install
npm run dev              # http://localhost:5173
npm run dev -- --host    # also serve on your LAN (for phone testing later, see below)
npm test                 # unit tests (Vitest)
npm run build            # typecheck + production build
```

Debug HUD: in dev it is always available via the **HUD** chip (top right of the prompt). In a production
build, add `?debug` to the URL to show the chip, or `?debug=1` to open the HUD immediately.
`?desync=1` opts into low-latency `desynchronized` canvases (experimental). It is off by default: on GPU
compositors such as Chrome on Windows a desynchronized canvas becomes a hardware overlay without alpha,
and the writing box turns black. Using it for real would need an opaque single-canvas design.

## Deploy (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`: install → unit tests → build → publish `dist/`.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/<repo>/` (assets use relative URLs, so any repo
name works). Add `?debug=1` to open the HUD on the deployed site.

GitHub Pages is HTTPS, i.e. a secure context — so `getCoalescedEvents()` works on a phone that opens the
deployed URL directly, no USB forwarding needed.

## How it works

```
React (UI state only)
  WorkspaceScreen ── index, mode, phase           (never re-renders while writing or animating)
   ├─ HandwritingCanvas  mounts once, calls engine.attach(); re-renders on char/mode/data change only
   │   └─ StrokeOrderView   SVG reference from stroke data (font glyph if a character has none)
   ├─ Controls           subscribes to engine snapshot → re-renders once per committed stroke
   │   └─ StrokeControls    (Observe) subscribes to animator snapshot → re-renders ≈ once per stroke
   └─ DebugHud           polls engine.stats every 250 ms into a <pre> (no React state)
        │ commands: undo() clear() reset() setInputEnabled() setSettings()
        ▼
HandwritingEngine (plain TypeScript)
  InputController  pointer events → normalized points (coalesced samples, 1 active pointer)
  InkModel         committed strokes + undo history (source of truth, pure, unit-tested)
  Renderer A/B     QuadRenderer (incremental Bézier) | FreehandRenderer (perfect-freehand)
  Layers           [DOM grid + reference] → static canvas → live canvas → tail canvas → [DOM reveal]

StrokeAnimator (plain TypeScript)  rAF loop → dash offset / data-state on StrokeOrderView's paths
```

Per pointer sample: `pointermove` → points appended to the current stroke → one `requestAnimationFrame`
draw of the live layers. On `pointerup` the stroke is added to `InkModel`, drawn once onto the static canvas,
and the snapshot changes (this is the only moment React hears about it). Undo, clear, resize, DPR change,
renderer switch and canvas context loss all redraw from the model — never from a bitmap.

## Stroke-order guide

In Observe (**Xem**) the character writes itself stroke by stroke in standard order, slowly, on a loop:
empty box → one stroke at a time with a short pause between → whole character held → again. The same
data draws the faint reference in Trace and the reveal in Recall, and is what scoring measures against —
what the learner watches, traces and is scored on is one shape.

- **Data.** [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) via `hanzi-writer-data` 2.0.1,
  unmodified: one JSON per character in `src/data/strokes/`, with stroke outlines (SVG paths) and
  medians (centerlines in writing direction). The data derives from Arphic fonts and is under the
  **Arphic Public License**, which covers those files only — source, format and license in
  [`src/data/strokes/README.md`](src/data/strokes/README.md). Every build ships the license and that
  notice under `licenses/` (a small plugin in `vite.config.ts`).
- **One transform.** `src/strokes/transform.ts` is the only mapping from dataset coordinates (1024-unit
  em square, y up) to the box, at the size and centering the font reference used. The SVG glyph, the
  animation and the scorer's raster all go through it.
- **Drawing** (`StrokeOrderView`). The whole character as faint ghost outlines; over it, per stroke, a
  wide round-capped line along the median, clipped to that stroke's outline and revealed with
  `stroke-dashoffset`. Width 200 dataset units (radius 100): no bundled outline is farther than 84
  from its median (measured by `medianPath.test.ts` over every bundled file). The stroke being drawn
  is in the accent color, finished ones in ink; strokes not yet started are hidden, since a
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
  the next character rests on the whole character. › draws the next stroke from its start, then pauses;
  ‹ removes the last one; while paused, the stroke named in **Nét k/N** stays in the accent color. Play
  from the whole character starts over. At the end of each loop the character fades out (300 ms) instead
  of cutting to an empty box. ‹ and › use `aria-disabled` at the ends so they keep keyboard focus; steps
  are announced to screen readers, autoplay is not.
- **Reduced motion.** No sweep and no fades: each stroke appears whole at its turn. A character starts
  paused on the whole character until the learner presses play. The setting is followed live.
- **Bundled.** The data is bundled eagerly (about 14 KB for the five characters), so the reference is
  there synchronously: no loading state and no runtime failure path. Characters without data use the
  font glyph — static, without stroke controls. When the set grows, load per character by URL
  (`query: '?url'` + `fetch`), not `import()`: browsers keep a failed dynamic import for the life of the
  page, so it could never be retried.

**Adding a character:** copy `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json` to
`src/data/strokes/<code point in lowercase hex>.json` — no code change, the loader and the width test
pick it up. To practice it, also add it to `src/data/testChars.ts` (which puts it in the scoring
alignment test); if its Unihan stroke count differs from the data, the data wins and scoring warns.

## Scoring (heuristic prototype)

"Chấm điểm" in Trace and Recall gives a 0–100 **feedback score from stroke geometry**. It is not
character recognition, not ML, and not a measure of correctness.

```
UI ── HandwritingScorer (interface, async) ── GeometryScorer               (today)
                                          └─ MLHandwritingScorer          (later, same interface)
   ── ReferenceProvider (interface) ──────── StrokeDataReferenceProvider  (today: bundled stroke outlines)
                                              └─ GlyphReferenceProvider   (fallback: device font glyph)
```

Swap implementations in `src/handwriting/scoring/index.ts`; tune weights and tolerances in
`src/handwriting/scoring/config.ts`.

**Reference data today: Partial.** For characters with bundled stroke data (all five), the stroke
outlines are filled into a 128² mask by `src/strokes/rasterize.ts` (nonzero fill sampled at pixel
centers, the scorer's own raster convention) through the same transform as the on-screen glyph, so
the learner is scored against exactly what they see; the stroke count is the data's. Other characters
fall back to the font glyph:
typeset offscreen with the same font, size and centering as the on-screen reference (not a
screenshot), thresholded into the mask, plus the standard stroke count (Unihan kTotalStrokes).

The medians are **deliberately not** passed as `ReferenceCharacter.strokes` yet: that switches the
scorer to its Full path (a raster of the medians plus per-stroke length comparison), which is not
calibrated and belongs with stroke-order scoring. So the level stays Partial and stroke order is still
never scored (shown as N/A), even though the data now has it.

An end-to-end alignment test (`StrokeDataReferenceProvider.test.ts`) checks that outlines, medians,
transform and raster agree: ink tracing a character's medians scores ≈ 97–98 in Trace and Recall;
in Trace, the same ink shifted by ±0.06 box on both axes scores ≤ 55 and another character's medians
score ≤ 63.

| Component | How | Trace | Recall |
|---|---|---|---|
| Shape | Oriented matching of ink vs reference centerline (skeleton), both ways → F-score. Direction must agree within 30°. Recall aligns the ink's bounding box to the reference first. | 40% | 50% |
| Position | Symmetric mean distance ink ↔ reference, in place | 35% | 25% |
| Length | Total ink length vs reference centerline length (log ratio) | 15% | 15% |
| Stroke count | \|user − standard\| / standard | 10% | 10% |
| Stroke order | — not scored yet — | 0 | 0 |

Weights are renormalized over the components that could be scored. Without any geometric reference
the scorer returns `insufficient-reference` instead of a number.

Known limitations: on the font fallback the reference depends on the installed font (KaiTi vs YaHei
give slightly different references); stroke direction (which end a stroke starts from) is not checked;
ink that happens to follow the reference structure scores high even if written in the wrong way (e.g.
a grid hatched over 國 ≈ 80, measured against the font reference); thresholds are calibrated on
synthetic ink, not on real learners.

## What desktop testing can validate

- Architecture: React isolation (HUD → `commits during last stroke: 0`), engine/React boundary
- Input pipeline: pointer capture, single active pointer, coalesced events support, right-click ignored
- Rendering: renderer A vs B switching, stroke width, predicted events toggle, high-DPI crispness at
  different browser zoom levels
- Undo / Clear / Undo-after-Clear, mode transitions, Recall → Reveal → rating flow
- Stroke-order playback: order, pace, stepping, looping; reduced motion via DevTools rendering emulation
- Resize behavior: resize the window or zoom the browser — ink keeps its geometry
- Performance instrumentation: per-frame draw cost, JS-side input→draw delay, long-session stability
- Layout sanity with DevTools device emulation (portrait + landscape)

## What desktop testing cannot validate

- Real finger comfort, stroke width feel, finger occlusion on a physical screen size
- Actual touchscreen latency (the HUD's `in→draw` is JS-side only; it excludes compositor and display)
- Mobile browser gesture conflicts: edge-swipe back, pull-to-refresh, toolbar show/hide, system gestures
- Real stylus behavior (pressure curves, hover, barrel buttons) and palm rejection
- Coalesced sampling rates of real digitizers (120–240 Hz touch panels)
- iOS Safari specifics

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
3. Checklist:
   - [ ] 30 strokes in a row: no page scroll, zoom, text selection, context menu or callout
   - [ ] Fast flicks: strokes never break into segments; HUD shows `samples/ev > 1` (coalescing works)
   - [ ] Rotate portrait ↔ landscape mid-session: ink keeps its shape and position
   - [ ] App to background → foreground: ink is still there
   - [ ] HUD `commits during last stroke: 0` after every stroke
   - [ ] Performance panel: no long tasks > 16 ms while writing continuously for 30 s
   - [ ] Edge swipes near the box edges don't trigger browser back
   - [ ] Undo / Clear are not hit accidentally while writing near the bottom of the box
   - [ ] Renderer A vs B: rate the feel 1–5 on 永 你 学 國 謝 with a finger (and a stylus if available)

## Project layout

```
src/
  handwriting/          engine — no React except the two React adapters
    types.ts            Point, Stroke, Ink, Op
    coords.ts           client px → normalized box coordinates
    InkModel.ts         strokes + undo history (pure)
    InputController.ts  pointer events → samples
    HandwritingEngine.ts
    renderers/          Renderer interface, QuadRenderer (A), FreehandRenderer (B)
    scoring/            HandwritingScorer / GeometryScorer, reference providers (stroke data, font)
    HandwritingCanvas.tsx, useEngineState.ts   React adapters
  strokes/              stroke-order data → screen and scorer; no React except the view and hook
    transform.ts        the one dataset → box mapping
    strokeData.ts       bundled data access + validation
    svgPath.ts, rasterize.ts   outline parsing and fill (scoring reference)
    timeline.ts         loop timing, stepping, pace (pure)
    StrokeAnimator.ts   rAF playback controller
    medianPath.ts, StrokeOrderView.tsx, useStrokeData.ts   SVG view + React hook
  debug/                DebugHud, React commit counters
  workspace/            WorkspaceScreen, Controls, StrokeControls, ResultPanel
  data/testChars.ts     5 prototype characters (not the content system)
  data/strokes/         stroke data, one JSON per character (Arphic Public License, see its README)
```

## Known limitations

- Stroke data is bundled for the 5 prototype characters only. Any other character falls back to a
  system-font glyph, without animation. A Kai (楷) style font is needed for learning handwriting;
  KaiTi is used when installed, otherwise it falls back to Song/Hei styles. Bundling a licensed Kai
  font (e.g. LXGW WenKai, OFL-1.1) is a later decision.
- Traditional characters (國 謝) follow the dataset's mainland (PRC) stroke-order conventions. Taiwan's
  standard order differs for some characters; this has not been verified character by character.
- At hooks and sharp bends the reveal runs ahead of the brush by up to the cap radius (100 units,
  ≈ 8% of the box): the round cap uncovers outline near the brush that the median reaches only later.
- No persistence: ink and ratings are lost on reload. Ratings are only logged to the console.
- Ink color is fixed; no dark mode.
