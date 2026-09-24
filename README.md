# Chinese Notebook — handwriting prototype (P1)

A handwriting-first Chinese learning web app for Vietnamese learners. This repository currently
contains **the handwriting prototype**: one workspace for writing Hanzi with a finger, stylus or mouse,
with Observe / Trace / Recall modes, heuristic scoring, a stroke-by-stroke review and a debug HUD. In
Observe the character writes itself in stroke order, from bundled stroke data that also draws the Trace
and Recall references and the scoring reference. A small app shell (hash router, error boundary) is in
place for the screens to come. No lessons, persistence, audio, backend or PWA yet — on purpose.

## Run

Node `^22.13 || ^24 || >=26` (`engines` in `package.json`: what Vite, Vitest and ESLint all support).

```bash
npm install
npm run dev              # http://localhost:5173
npm run dev -- --host    # also serve on your LAN (for phone testing later, see below)
npm test                 # unit tests (Vitest, node environment)
npm run lint             # ESLint, type-aware (correctness rules only, no style)
npm run typecheck        # TypeScript 7 for src/ and for e2e/ (with playwright.config.ts and vite.config.ts)
npm run build            # typecheck of src/ + production build
npm run test:e2e         # builds, then Playwright tests in the installed Google Chrome (preview on 127.0.0.1:4180)
npm run check            # lint + typecheck + unit + build (what CI runs before e2e)
```

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

## License

- **Code:** MIT — see [`LICENSE`](LICENSE).
- **Stroke data** (`src/data/strokes/*.json`): derived from Arphic fonts via Make Me a Hanzi, under the
  **Arphic Public License**, which covers those files only. Source and notice in
  [`src/data/strokes/README.md`](src/data/strokes/README.md); every build ships the license and that
  notice under `licenses/` (a small plugin in `vite.config.ts`).
- **Dependencies** keep their own licenses (React, scheduler and perfect-freehand: MIT). The minified
  bundle drops their notices, so every build also ships `licenses/third-party.md`, listing each
  bundled package with its license text (Vite's `build.license`).
- Any data set added later (a dictionary, example sentences) gets its own folder with its source and
  license, like the stroke data, and ships its license in the build the same way.

## CI and deploy (GitHub Pages)

One workflow, `.github/workflows/ci.yml`:

- **Every push to any branch, and every pull request from a fork:** job `check` on Node 24 — `npm ci`
  → lint → typecheck (fails unless the compiler is TS 7) → unit tests → build → e2e (installed Chrome,
  preview of that `dist/`); the Playwright report is uploaded when it fails. Job `node-min` runs lint,
  typecheck, unit tests and build on Node 22.13, the oldest Node `engines` promises. A pull request
  from a branch of this repository runs neither: its push was already checked.
- **Push to `main`, or a manual run on `main` (Actions → CI → Run workflow):** the `check` job also
  uploads that same, tested `dist/` as the Pages artifact, and job `deploy` (needs `check` and
  `node-min`) publishes it. Nothing is deployed unless every check passed. Other branches are checked,
  never deployed.
- A newer push cancels a running check on the same branch, except on `main`, so a deploy is never cut
  off halfway (`deploy` also has its own `pages` concurrency group, never cancelled). A manual run on
  `main` that replaces a queued push run checks and deploys the same, newest commit.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/<repo>/` (assets use relative URLs, so any repo
name works). Add `?debug=1` to open the HUD on the deployed site.

GitHub Pages is HTTPS, i.e. a secure context — so `getCoalescedEvents()` works on a phone that opens the
deployed URL directly, no USB forwarding needed.

## How it works

```
main.tsx     installGlobalErrorHandlers() · <ErrorBoundary context="app"> · <App>
App          hash router (router.ts): #/ → WorkspaceScreen, anything else under #/ → "not found"
React (UI state only)
  WorkspaceScreen ── practiceReducer (attempt.ts): index, mode, phase, attempt   (never re-renders while writing or animating)
   ├─ HandwritingCanvas  mounts once, calls engine.attach(); re-renders on char/mode/review change (or canvasError) only
   │   ├─ StrokeOrderView   SVG reference from stroke data (font glyph if a character has none)
   │   └─ StrokeNumbers     stroke-number badges; subscribes to the engine itself (once per committed stroke)
   ├─ Controls           subscribes to engine snapshot → re-renders once per committed stroke
   │   └─ StrokeControls    (Observe) subscribes to animator snapshot → re-renders ≈ once per stroke
   ├─ ResultPanel        after scoring: headline, issues, then buttons
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
```

Per pointer sample: `pointermove` → points appended to the current stroke → one `requestAnimationFrame`
draw of the live layers. On `pointerup` the stroke is added to `InkModel`, drawn once onto the static canvas,
and the snapshot changes (this is the only moment React hears about it). Undo, clear, resize, DPR change,
renderer switch and canvas context loss all redraw from the model — never from a bitmap.

**Engine API for what comes next** (saving, replay, review):

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
  however it ends. The shortest bundled strokes (the dots of 謝) reach 0.06 box, ten times that. So a
  tap moves neither the stroke count, nor the next-stroke badge, nor the Recall alignment. A still
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
workspace renders and drives the engine from.

- **Attempts.** An attempt is one go at one character in one mode. Every navigation — another
  character, another mode, "Viết lại", **the tab already active tapped again once the attempt is
  scored** — starts a new attempt, and the workspace resets the box whenever `attemptId` changes. So
  ink, verdict colors and results never outlive their attempt. The active tab tapped (or pressed with
  Enter/Space) while the attempt is still being written or scored does nothing: a reset cannot be
  undone, so it must not wipe a half-written character. "Xem" tapped again keeps the stroke-order
  playback where it is.
- **Phases:** `writing` → `scoring` (async) → `scored` → `revealed` (Recall). The box takes input only
  while writing. Scoring calls `flushInput()` then `getInk()`, colors the strokes for that ink's
  revision only, and an answer that comes back for an older attempt is dropped.
- **Recall lock.** Once Recall has shown the answer, tapping "Nhớ lại" again does nothing (a toast says
  why): the learner rates, or leaves. Leaving — to Xem / Tô theo, or to another character with ‹ / › —
  and coming back is allowed, but until the character is rated the prompt then says "bạn vừa xem mẫu"
  and the rating is logged with `peeked` (the reducer keeps the characters revealed and not yet
  rated). The Recall prompt names the script to write ("Viết chữ giản thể / phồn thể / này từ trí
  nhớ"), and the box's accessible name is "Ô viết chữ" — without the character — until the answer is
  shown.
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

**Screens.** `src/app/router.ts` is a tiny hash router (`#/path?query`; hash, because the site is
static at any sub-path). A screen is one entry in `ROUTES` plus one case in `App.tsx`. The viewport
lock (no page scroll, bounce or pull-to-refresh) is set on `html[data-lock]` only while the
workspace is mounted, so other screens scroll normally.

**Errors.** A top-level `ErrorBoundary` replaces a blank page with "Đã xảy ra lỗi" + "Tải lại"; it,
uncaught errors and unhandled rejections are logged with the build (mode + hashed entry chunk). When no
2D canvas is available (iOS canvas memory) the box itself says so while the rest of the app works. A
scoring failure shows a toast and returns to writing.

## Stroke-order guide

In Observe (**Xem**) the character writes itself stroke by stroke in standard order, slowly, on a loop:
empty box → one stroke at a time with a short pause between → whole character held → again. The same
data draws the faint reference in Trace and the reveal in Recall, and is what scoring measures against —
what the learner watches, traces and is scored on is one shape.

- **Data.** [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) via `hanzi-writer-data` 2.0.1,
  unmodified: one JSON per character in `src/data/strokes/`, with stroke outlines (SVG paths) and
  medians (centerlines in writing direction). License: see License above.
- **One transform.** `src/strokes/transform.ts` is the only mapping from dataset coordinates (1024-unit
  em square, y up) to the box, at the size and centering the font reference used. The SVG glyph, the
  animation, the scorer's raster, the stroke check and the e2e tests' tracing all go through it.
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
  the next character rests on the whole character. Tapping "Xem" while in Observe changes nothing. › draws the next stroke from its start, then pauses;
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
- **Stroke numbers in Trace** (`StrokeNumbers`, placement in `strokeLabels.ts`). A small numbered badge
  sits just before where each stroke starts — "behind" the start, opposite the writing direction —
  under the learner's ink. Placement is pure and cached per character: candidates on rings around the
  start, rejected if they leave the box or touch another badge, ranked by distance, turn away from
  "behind", overlap with the reference's ink (the scorer's outline raster + distance transform) and
  sitting nearer another stroke's start. Tested on every bundled character: no two badges touch, each
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

**Adding a character:** copy `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json` to
`src/data/strokes/<code point in lowercase hex>.json` — no code change, the loader and the width test
pick it up. To practice it, also add it to `src/data/testChars.ts` (which puts it in the scoring
alignment test); if its Unihan stroke count differs from the data, the data wins and scoring warns.

## Scoring (heuristic prototype)

"Chấm điểm" in Trace and Recall gives a 0–100 **feedback score from stroke geometry**. It is not
character recognition, not ML, and not a measure of correctness — the stroke-by-stroke review and the
headline rule above cover order, direction and missing strokes.

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

- **Unit** (`npm test`, Vitest in the node environment, `src/**/*.test.ts`): pure modules (ink model,
  input policy, geometry, scorer, stroke check, timeline, labels, practice reducer, result text,
  router, error reporting) and the engine and input controller themselves, run against the small DOM
  stand-ins in `src/handwriting/fakeDom.ts` (test-only; the app never imports it).
- **E2E** (`npm run test:e2e`, `e2e/*.spec.ts`, Playwright on the installed Google Chrome — channel
  `chrome`, nothing to download): the production build on a touch phone in two projects, portrait
  390×844 and landscape 844×390. Every test also fails on any console error or uncaught exception,
  except the ones a test declares it provokes (`test.use({ expectedErrors })`). Covered: load, Observe
  autoplay, Trace scoring of a faithful 永 (5/5 nét đúng), Recall write → score → rate → next;
  all strokes reversed is "Thử lại · 0/5 nét đúng"; re-tapping the active tab clears a scored attempt
  but keeps the ink while writing; a tap is not a stroke (the next-stroke badge stays on 1); Recall's
  box label hides the character until the answer is shown; the answer seen stays noted through ‹ / ›;
  a tap on a rating button right after "Chấm điểm" lands while the guard holds and does not rate;
  writing with a finger (touch events, `touchscreen()` in `e2e/fixtures.ts`), a hand resting on the
  box while the finger writes, a still press held on the box counted by the review; at 320×568 and
  568×320 the result never covers the box, its buttons show whole, the page does not scroll and the
  prompt is not clipped through a line; no 2D canvas → message in the box, app still usable; an error
  while mounting → the error page. `e2e/fixtures.ts` traces a character's medians through the app's
  own transform. Selectors are roles and visible text, except `.hw-box` (geometry), the badges'
  `data-state` (they are `aria-hidden`) and the result's layout classes.

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

## Project layout

```
src/
  main.tsx              global error handlers, top-level ErrorBoundary, <App>
  app/                  shell — App (screens by route), router (hash), ErrorBoundary, errorReporting,
                        LiveRegion, viewportLock
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
    strokeData.ts       bundled data access + validation
    svgPath.ts, rasterize.ts   outline parsing and fill (scoring reference)
    timeline.ts         loop timing, stepping, pace (pure)
    StrokeAnimator.ts   rAF playback controller
    medianPath.ts, StrokeOrderView.tsx, useStrokeData.ts   SVG view + React hook
    strokeLabels.ts, StrokeNumbers.tsx   stroke-number badges (placement, view)
    strokeCheck.ts      stroke-by-stroke alignment and verdicts after scoring (pure)
  debug/                DebugHud (lazy chunk), React commit counters
  workspace/            WorkspaceScreen, Controls, StrokeControls, ResultPanel
    attempt.ts          practice flow state machine (pure)
    resultText.ts       headline rule, labels, announcement, interruption lines (pure)
    strokeFeedback.ts   stroke check → counts and issue lines (pure)
    promptText.ts       Recall instruction, box label (pure)
  data/testChars.ts     5 prototype characters (not the content system)
  data/strokes/         stroke data, one JSON per character (Arphic Public License, see its README)
e2e/                    Playwright smoke and regression tests (fixtures.ts: tracing by mouse or touch, score reading)
.github/workflows/ci.yml   check every branch; deploy main after every check passed
```

## Known limitations

- Stroke data is bundled for the 5 prototype characters only. Any other character falls back to a
  system-font glyph, without animation or stroke review. A Kai (楷) style font is needed for learning
  handwriting; KaiTi is used when installed, otherwise it falls back to Song/Hei styles. Bundling a
  licensed Kai font (e.g. LXGW WenKai, OFL-1.1) is a later decision.
- Traditional characters (國 謝) follow the dataset's mainland (PRC) stroke-order conventions. Taiwan's
  standard order differs for some characters; this has not been verified character by character.
- At hooks and sharp bends the reveal runs ahead of the brush by up to the cap radius (100 units,
  ≈ 8% of the box): the round cap uncovers outline near the brush that the median reaches only later.
- No persistence: ink and ratings are lost on reload. Ratings are only logged to the console
  (`[rating]`, with `peeked` and the ink); a store would hook into `WorkspaceScreen`'s `onRate`.
- The practice screen does not read route parameters yet (e.g. `#/?char=学` from a dictionary): its
  characters still come from `TEST_CHARS`.
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
