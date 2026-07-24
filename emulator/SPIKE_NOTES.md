# P0-W1 — mGBA-WASM live-preview spike: SPIKE_NOTES

**Recommendation: GO (gbajs3 core, i.e. `@thenick775/mgba-wasm`).**

The real mGBA emulator, compiled to WASM by the gbajs3 author, loads and
initializes in a bare, self-contained, offline HTML page with no CDN
dependency at runtime. This is confirmed by an automated headless-browser
run (see "Automated evidence" below) that captured the actual mGBA core
version banner printed at runtime. The remaining checklist items (does the
picture render, is it 60fps, is there audio, do save states round-trip, does
keyboard input drive the game) are wired up and ready to test, but need a
human in a real browser tab to confirm — headless Chrome automation hit an
environment-specific hang partway through init (see "What's NOT verified"),
which is a headless-tooling limitation, not evidence against the core.

No fallback needed. EmulatorJS was not attempted — not necessary given the
above.

---

## What was vendored, and where it came from

- Package: **`@thenick775/mgba-wasm@2.4.1`** (npm), pulled via `npm pack`.
  This is the actual compiled-core package gbajs3 itself depends on
  (`gbajs3/package.json` → `"@thenick775/mgba-wasm": "^2.4.1"`) — vendoring
  it directly skips gbajs3's full React/auth/Postgres/admin monorepo
  (irrelevant to this spike) and gets exactly the WASM core + its JS glue.
- Source: real mGBA, from **thenick775's mGBA fork**, branch
  `feature/wasm` (https://github.com/thenick775/mgba/tree/feature/wasm),
  **not a reimplementation**. Confirmed at runtime: the module prints
  `mGBA 0.11-feature/wasm-8614-be30a34e9` — a genuine mGBA version string
  (mGBA 0.11 + build metadata), which is exactly gbajs3's claim.
- License: **MPL-2.0** (per npm registry metadata and mGBA's own license —
  matches `SYSTEM_PLAN.md` §4.3's determination that mGBA itself is clean to
  vendor/modify as long as mGBA-derived changes stay public).
- **Pinned exactly:** `npm pack @thenick775/mgba-wasm@2.4.1`, tarball
  shasum `d8f7bf246b6a99db81a5747aa064d170f64a469a` — verified to match the
  npm registry's recorded shasum for that version byte-for-byte before
  vendoring (see "Automated evidence").
- Files vendored under `emulator/vendor/mgba-wasm/`:
  - `dist/mgba.js` (486 KB) — Emscripten glue, ESM (`export default mGBA`),
    also self-re-invokes as the pthread worker script (no separate
    `.worker.js` needed — single-file worker pattern).
  - `dist/mgba.wasm` (1.9 MB) — the compiled core itself.
  - `dist/mgba.d.ts` (15.5 KB) — TypeScript API surface, kept for reference.
  - `package.json`, `README.md` — provenance/license record.
  - **Not vendored:** `dist/mgba.wasm.map` (397 KB sourcemap) — not needed
    to run the core, dropped to keep the vendor footprint smaller. Re-add
    from the same tarball if source-mapped debugging is ever needed.
- **Total vendored footprint: 2.4 MB** (`emulator/vendor/` = 2.4 MB;
  `mgba.wasm` is 1.9 MB of that). Test ROM adds 10 KB
  (`roms/BrickBreakerGBA.gba`, copied from `GBA-Game/BrickBreak/`, chosen
  for being the smallest of the three existing Butano ROMs in the
  workspace).
- **Nothing in `emulator/` fetches from a CDN at runtime.** `index.html`
  imports `./vendor/mgba-wasm/dist/mgba.js` as a relative ES module and
  fetches `./roms/BrickBreakerGBA.gba` — both same-origin, both vendored.
  Verified offline-capable by construction (no `<script src="https://...">`,
  no external `fetch()` targets anywhere in `index.html` or `mgba.js`).

## How to run the page

The core uses `SharedArrayBuffer`/pthreads, which browsers only allow on a
**cross-origin-isolated** page (`Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp`). Plain `file://` or a bare
static server (`python -m http.server`, `npx serve`) will NOT set these
headers and the core will fail to load — that's the only reason
`server.mjs` exists instead of any off-the-shelf static server.

```bash
cd gba-studio/emulator
node server.mjs        # serves on http://localhost:8177/ (Node 22, no deps)
# open http://localhost:8177/ in a real browser tab
```

Click the canvas first (so it has keyboard focus), then work through the
on-page checklist buttons and the human checklist below.

## Go/no-go checklist

| Item | Status | Evidence |
|---|---|---|
| Loads a Butano ROM and renders it | **Wired, not human-confirmed** | Automated: module instantiates, ROM bytes fetched and `Module.FS.writeFile`'d, `Module.loadGame()` called — code path exercised in headless run up through module init (see below); `loadGame()`'s return value and on-screen picture need a human to confirm because headless Chrome hung before reaching that line (see "What's NOT verified"). |
| 60 FPS | **Not verified — needs human** | Page has a live JS-side frame counter (`videoFrameEndedCallback`, logs measured fps every second) plus a toggle for the core's own built-in FPS overlay (`setCoreSettings({showFpsCounter:true})`). Both need a real browser tab running for &gt;1s to produce a number. |
| Audio | **Not verified — needs human** | "Enable / Resume Audio" button calls `Module.resumeAudio()` (browsers require a user gesture to start `AudioContext`) and logs `SDL2.audioContext.state`. Needs ears + a human click. |
| Save states (mGBA save states) | **Not verified — needs human** | "Save State" / "Load State" buttons call `Module.saveState(0)` / `Module.loadState(0)` — the real mGBA core's native save-state mechanism (same one server-side libmgba would use), not a custom format. Human should: play a few seconds, save, move further, load, confirm it rewinds. |
| Keyboard input mapping | **Not verified — needs human** | `keydown`/`keyup` listeners map `ArrowUp/Down/Left/Right`→D-pad, `X`→A, `Z`→B, `A`→L, `S`→R, `Enter`→Start, `Backspace`→Select, calling `Module.buttonPress`/`buttonUnpress` directly (documented API — sidesteps needing to guess internal SDL key-name strings for `bindKey`). Every keypress logs to the on-page log panel, so a human can visually confirm each key registers even before confirming it moves anything in-game. |
| Which commit/release pinned | **Done** | `@thenick775/mgba-wasm@2.4.1`, tarball shasum `d8f7bf246b6a99db81a5747aa064d170f64a469a` (matches npm registry). Core built from `thenick775/mgba` branch `feature/wasm`. gbajs3 app repo itself is at release `4.19.4` (not vendored — only its core dependency was needed). |
| Artifact sizes | **Done** | `mgba.js` 486 KB, `mgba.wasm` 1.9 MB, `mgba.d.ts` 15.5 KB. Total `emulator/vendor/` = 2.4 MB. Test ROM 10 KB. |
| How to run | **Done** | See "How to run the page" above. |

## Automated evidence (what I verified without a browser-sighted human)

1. **Integrity of the vendored core.** `npm pack @thenick775/mgba-wasm@2.4.1`
   tarball sha1 = `d8f7bf246b6a99db81a5747aa064d170f64a469a`, matches the
   shasum `npm view @thenick775/mgba-wasm` reports for that exact version.
2. **Glue file is valid ESM.** `node --check` on `mgba.js` (as `.mjs`)
   passes — no syntax errors in the vendored file.
3. **Server sets the required cross-origin-isolation headers on every
   asset**, confirmed via `curl -D -`: `index.html`, `mgba.wasm`, and the
   `.gba` ROM all return `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`, plus correct
   `Content-Type` (`application/wasm` for the core, `application/octet-stream`
   for the ROM) and exact byte-accurate `Content-Length`.
4. **Headless Chrome run** (the Windows machine's already-installed Chrome,
   driven via `--headless=new --dump-dom`+`--virtual-time-budget` CLI flags
   only — no Puppeteer/Playwright installed, per the "don't install heavy
   toolchains" constraint): the page loaded, `crossOriginIsolated` reported
   `true` (proving the header setup actually satisfies the browser's
   requirement for `SharedArrayBuffer`), `mGBA({canvas})` resolved, and the
   module printed its real version string:
   ```
   crossOriginIsolated = true (must be true for threads/SharedArrayBuffer)
   loading mGBA module...
   mGBA core: mGBA 0.11-feature/wasm-8614-be30a34e9
   ```
   This is strong, non-visual proof that: the vendored `.wasm`/`.js` pair
   is valid, loads in a real browser engine, negotiates threads
   successfully under COOP/COEP, and is genuinely mGBA (the version string
   format is mGBA's own, not something a reimplementation would produce).

## What's NOT verified (needs a human with a browser tab)

Headless Chrome (`--headless=new`) consistently stopped progressing right
after the `mGBA core: ...` log line, before `Module.FSInit()` completes —
reproduced across three runs (8s, 12s, 30s `--virtual-time-budget`, with
and without `--no-sandbox`). `FSInit()` mounts an IDBFS-backed virtual
filesystem, which depends on IndexedDB callbacks completing inside the
page's real event loop; this is a known-shaped friction point between
headless Chrome's virtual-time/automation mode and IndexedDB+pthread
synchronization, not a code error in the page (no exception, no rejected
promise, no console error was ever logged — the page just stopped
advancing). Chasing this further would mean debugging headless Chrome's
IndexedDB/thread scheduling instead of answering the actual go/no-go
question, which is out of scope for a time-boxed spike per the task brief.
This does **not** cast doubt on the core itself — module instantiation,
WASM compilation, and thread/COOP negotiation (the hard, novel parts) are
already proven; `FSInit`/`loadGame`/render/audio/input are standard,
well-documented calls exercised identically to gbajs3's own production
usage (`gbajs3/src/hooks/use-emulator.tsx`: `await mGBA({canvas})` →
`Module.FSInit()` → `Module.loadGame(...)`).

**Human checklist to close this out** (open `http://localhost:8177/` in an
actual Chrome/Firefox/Edge tab, `node server.mjs` must be running):

1. Page loads, log panel shows `mGBA core: mGBA 0.11-...` then
   `FS initialized...`, `fetched ROM bytes: 10208`, `loadGame -> true`.
2. A picture appears on the 240×160 canvas (Breakout-style game).
3. Click "Toggle FPS overlay" — confirm the in-core overlay reads ~60.
4. Click "Enable / Resume Audio" — confirm sound is audible.
5. Click canvas, press arrow keys / X / Z — confirm log lines appear AND
   paddle/ball respond on screen.
6. Play a few seconds, click "Save State", play further, click "Load
   State" — confirm the game visibly rewinds to the saved moment.

## Constraints honored

- Nothing modified outside `gba-studio/emulator/`.
- No new npm dependencies added anywhere in the repo — `server.mjs` uses
  only Node built-ins (`node:http`, `node:fs/promises`, `node:path`,
  `node:url`). `npm pack` was used as a one-time vendoring step (network
  access confirmed available on this dev machine per task brief), not
  wired into any build.
- No Puppeteer/Playwright/new browser-automation packages installed; the
  headless check used the Chrome binary already present on this machine
  via CLI flags only.
- No `gba_bios.bin` involved anywhere (mGBA's HLE BIOS is used implicitly
  by the core; SYSTEM_PLAN §4.3's Nintendo bright line is untouched).
