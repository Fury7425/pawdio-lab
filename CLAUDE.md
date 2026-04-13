# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server only (no Tauri, browser preview) |
| `npm run dev:tauri` | Full desktop app with hot reload (requires Rust toolchain) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run build:fast` | Vite build without type checking |
| `npm run format` | Prettier formatting |
| `npm run tauri:build` | Build platform installer (.msi / .app / .AppImage) |
| `npm run release:set` | Bump version/name/identifier across config files |
| `npm run release:build` | Bump metadata then build installer |

There are no test commands — the project has no automated test suite.

## Architecture

Pawdio Lab is a **Tauri 2** desktop application for audio diagnostics (latency, frequency response, THD, crosstalk, channel balance, isolation).

### Frontend — `src/`

- **`ui/use-pawdio-lab.ts`** (~1800 lines) is the single central hook that owns all React state, calls every Tauri IPC command, registers all Tauri event listeners, and syncs to localStorage. Almost all logic lives here.
- **`ui/pages/`** — five pages (devices, latency, sweep-fr, experimental, results); each page is a pure presentation layer that reads state/callbacks from the hook.
- **`ui/app-shell.tsx`** — top-level layout; renders sidebar + active page.
- **`ui/theme.ts`** — dark/light mode + 4 accent colors; `startAppearanceThemeSync()` is called once at app init.

localStorage keys:
- `pawdio-lab-ui-state-v1` — active page, device selections, test params
- `pawdio-lab-latency-calibration-v1` — per-preset calibration offsets
- `pawdio-lab-latency-ui-v1` — latency page UI prefs
- `pawdio-lab-device-ui-v1` — appearance mode, accent color, bit depth

### Backend — `src-tauri/src/`

- **`main.rs`** (~460 lines) — Tauri command handlers (thin wrappers that spawn blocking tasks and emit `test-progress` events).
- **`audio/mod.rs`** (~3850 lines) — `AudioEngine` struct with all DSP: FFT cross-correlation for latency, log-chirp sweep for FR, THD/balance/crosstalk/isolation measurements, real-time input monitor, PNG chart generation (plotters), multi-format export.

Key Rust crates: `cpal` (audio I/O), `rustfft`, `plotters`, `tokio`, `tauri-plugin-dialog`.

### IPC Pattern

Frontend calls Tauri commands via `@tauri-apps/api/core` `invoke()`. Long-running audio tests emit `test-progress` string events that the frontend listens to with `listen('test-progress', ...)`. The hook in `use-pawdio-lab.ts` is the only place that calls `invoke` or `listen`.

## Code Style

Prettier is enforced (trailing commas, semicolons, LF line endings). Run `npm run format` before committing.
