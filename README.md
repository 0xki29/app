# Chinese Notebook — handwriting prototype (P1)

A handwriting-first Chinese learning web app. This repository currently contains **only the handwriting
prototype**: one workspace for writing Hanzi with a finger, stylus or mouse, with Observe / Trace / Recall
modes and a debug HUD. No lessons, persistence, audio, backend or PWA yet — on purpose.

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
  WorkspaceScreen ── index, mode, revealed        (never re-renders while writing)
   ├─ HandwritingCanvas  mounts once, calls engine.attach(); re-renders only on char/mode change
   ├─ Controls           subscribes to engine snapshot → re-renders once per committed stroke
   └─ DebugHud           polls engine.stats every 250 ms into a <pre> (no React state)
        │ commands: undo() clear() reset() setInputEnabled() setSettings()
        ▼
HandwritingEngine (plain TypeScript)
  InputController  pointer events → normalized points (coalesced samples, 1 active pointer)
  InkModel         committed strokes + undo history (source of truth, pure, unit-tested)
  Renderer A/B     QuadRenderer (incremental Bézier) | FreehandRenderer (perfect-freehand)
  Layers           [DOM grid + reference] → static canvas → live canvas → tail canvas → [DOM reveal]
```

Per pointer sample: `pointermove` → points appended to the current stroke → one `requestAnimationFrame`
draw of the live layers. On `pointerup` the stroke is added to `InkModel`, drawn once onto the static canvas,
and the snapshot changes (this is the only moment React hears about it). Undo, clear, resize, DPR change,
renderer switch and canvas context loss all redraw from the model — never from a bitmap.

## What desktop testing can validate

- Architecture: React isolation (HUD → `commits during last stroke: 0`), engine/React boundary
- Input pipeline: pointer capture, single active pointer, coalesced events support, right-click ignored
- Rendering: renderer A vs B switching, stroke width, predicted events toggle, high-DPI crispness at
  different browser zoom levels
- Undo / Clear / Undo-after-Clear, mode transitions, Recall → Reveal → rating flow
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
    HandwritingCanvas.tsx, useEngineState.ts   React adapters
  debug/                DebugHud, React commit counters
  workspace/            WorkspaceScreen, Controls
  data/testChars.ts     5 prototype characters (not the content system)
```

## Known limitations

- Reference glyph uses system fonts. A Kai (楷) style font is needed for learning handwriting; KaiTi is
  used when installed, otherwise it falls back to Song/Hei styles. Bundling a licensed Kai font (e.g.
  LXGW WenKai, OFL-1.1) is a later decision.
- No persistence: ink and ratings are lost on reload. Ratings are only logged to the console.
- Ink color is fixed; no dark mode.
