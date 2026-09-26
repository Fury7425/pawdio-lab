# CLAUDE.md

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server only (no Tauri, browser preview) |
| `npm run dev:tauri` | Full desktop app with hot reload (requires Rust toolchain) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run build:fast` | Vite build without type checking |
| `npm run preview` | Vite preview of production build |
| `npm run typecheck` | `tsc --noEmit` standalone TS check |
| `npm run lint` | ESLint over `src/` |
| `npm run test` | Vitest single run |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with v8 coverage |
| `npm run format` | Prettier formatting |
| `npm run tauri:build` | Build platform installer (.msi / .app / .AppImage) |
| `npm run release:set` | Bump version/name/identifier across config files |
| `npm run release:build` | Bump metadata then build installer |

Tests: Vitest + Testing Library + jsdom. `src/test-setup.ts` extends `expect` with jest-dom matchers. Suite is minimal — infra exists, coverage is light.

## Architecture

**Tauri 2** desktop app — audio diagnostics: latency, frequency response, THD, crosstalk, channel balance, ANC/Transparency per-frequency attenuation.

### Frontend — `src/`

- **`ui/use-pawdio-lab.ts`** (~1950 lines) — central hook. Owns all React state, consumes the IPC wrappers in `src/ipc/commands.ts` (including the event subscriptions), syncs to localStorage. Almost all logic lives here.
- **`ui/pages/`** — seven pages (devices, latency, sweep-fr, anc, experimental, results/logs, library) plus `pages/compare/` for library comparisons. Pure presentation layer; reads state/callbacks from hook.
- **`ui/lib/save-text.ts`** — every export without a chosen output folder goes through the native save dialog here (a blob download only in the plain browser preview).
- **`ui/pages/anc-page.tsx`** — guided 4-mode capture (off / ANC / transparency / reference), SVG attenuation curve, PNG + TXT export.
- **`ui/app-shell.tsx`** — top-level layout; renders sidebar + active page.
- **`ui/theme.ts`** — dark/light mode + 4 accent colors; `startAppearanceThemeSync()` called once at app init.
- **`ipc/commands.ts`** — single IPC boundary. All `invoke()`, `listen()` and dialog-plugin calls live here; consumed by the hook and the small libs.

localStorage keys:
- `pawdio-lab-ui-state-v1` — active page, device selections, test params
- `pawdio-lab-latency-calibration-v1` — per-preset calibration offsets
- `pawdio-lab-latency-ui-v1` — latency page UI prefs
- `pawdio-lab-device-ui-v1` — appearance mode, accent color
- `pawdio-lab-anc-yaxis-v1` — ANC graph y-axis mode
- `pawdio-lab-curve-view-v1` — smoothing, normalisation, compensation and bounds selections
- `pawdio-lab-compensation-v1` — compensation/bounds curves loaded from text files
- `pawdio-lab-spl-calibration-v1` — microphone sensitivity per input device
- `pawdio-lab-shortcuts-v1` — keyboard shortcut bindings

### Wireless (Bluetooth) mode

`AudioSettings.bluetoothMode` changes how every measurement except latency is captured. Sweep FR and ANC play the excitation inside a marker layout and align against it (`audio/alignment.rs`); the tone tests (THD, balance, crosstalk) record longer and pick their analysis window by energy instead of assuming it starts at sample zero. **The latency test ignores the flag on purpose** — the link delay the other tests remove is the quantity latency exists to report.

### Latency

Three presets, each a one-octave log chirp centred on 200 Hz, 5 kHz or 10 kHz. `find_delay_ms` takes the peak of the cross-correlation *envelope* with no window on either signal (a window over the recording biases the answer towards the capture's centre). Calibration keys are `chirp_200` / `chirp_5k` / `chirp_10k`, shared by `calibrationKeyForRequest` (TS) and `latency_preset_identity` (Rust). A suite passes one `sharedRunTag` so plots, bar chart and report share a folder.

### Stopping

`play_and_record` polls the cancel flag, so Stop ends a capture in flight and surfaces as a `measurement cancelled` error. Latency and THD keep the iterations already measured; sweep and ANC return the error rather than a partial average. The UI treats that error as a user action, not a failure, and a guided sweep session also ends on Stop.

### Backend — `src-tauri/src/`

- **`main.rs`** (~800 lines) — Tauri command handlers. Thin wrappers; spawn blocking tasks, emit `test-progress` events, validate requested output folders.
- **`db.rs`** — SQLite measurement library (devices + measurements, payload stored as JSON).
- **`audio/mod.rs`** (~5600 lines) — `AudioEngine` with all DSP: FFT cross-correlation for latency, log-chirp sweep for FR, THD/balance/crosstalk, real-time input monitor, PNG chart generation (plotters), multi-format export. ANC snapshot capture (`AncSnapshot`, `capture_anc_snapshot`) for per-frequency attenuation across capture modes.
- Sweep exports: `write_sweep_outputs()` writes every plot and Squiglink file from a set of curves. Guided runs capture with exports off and call `save_sweep_outputs` once with the accepted sweeps.
- Devices are identified by name (`outputDeviceName` / `inputDeviceName`); the enumeration index only breaks ties, because it shifts when devices are plugged in.
- `AudioSettings.inputBitDepth` (`auto` / `16` / `24` / `32`) picks the capture sample format: I16, I32 (24-bit converters use 32-bit containers; cpal 0.15 has no packed 24-bit) or F32. A depth the input does not offer falls back to the device default; `AudioDeviceInfo.bitDepths` lists what each input offers.
- **`audio/alignment.rs`** — pure, hardware-free marker alignment used by wireless mode. Builds coded timing markers around an excitation, locks onto them with FFT normalised cross-correlation, measures clock drift between the two end markers, and resamples the captured window back to nominal length. Rejects a capture with a typed `AlignmentFailure` rather than returning a wrong curve. Has its own `#[cfg(test)]` suite driven by synthetic recordings.

Key Rust crates: `cpal` (audio I/O), `rustfft`, `plotters`, `tokio`, `tauri-plugin-dialog`.

### IPC

Frontend → Tauri via `@tauri-apps/api/core`. All `invoke()` and `listen()` calls live in `src/ipc/commands.ts` (single IPC boundary). `use-pawdio-lab.ts` consumes those wrappers — no other file calls raw `invoke`/`listen`. Long tests emit `test-progress` string events.

## Code Style

Prettier enforced: trailing commas, semicolons, LF line endings. Run `npm run format` before committing.

ESLint (`eslint src`) + typescript-eslint enforce TS rules. Husky + lint-staged run `prettier --write` + `eslint --fix` on staged `.ts/.tsx`, `cargo fmt` on staged `.rs`. `npm run typecheck` for standalone TS check.
