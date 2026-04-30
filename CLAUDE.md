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

**Tauri 2** desktop app — audio diagnostics: latency, frequency response, THD, crosstalk, channel balance, isolation, ANC/Transparency per-frequency attenuation.

### Frontend — `src/`

- **`ui/use-pawdio-lab.ts`** (~1800 lines) — central hook. Owns all React state, consumes the IPC wrappers in `src/ipc/commands.ts`, registers all Tauri event listeners, syncs to localStorage. Almost all logic lives here.
- **`ui/pages/`** — six pages (devices, latency, sweep-fr, anc, experimental, results). Pure presentation layer; reads state/callbacks from hook.
- **`ui/pages/anc-page.tsx`** — guided 4-mode capture (off / ANC / transparency / reference), SVG attenuation curve, PNG + TXT export.
- **`ui/app-shell.tsx`** — top-level layout; renders sidebar + active page.
- **`ui/theme.ts`** — dark/light mode + 4 accent colors; `startAppearanceThemeSync()` called once at app init.
- **`ipc/commands.ts`** — single IPC boundary. All `invoke()` and `listen()` calls live here; consumed by the hook.

localStorage keys:
- `pawdio-lab-ui-state-v1` — active page, device selections, test params
- `pawdio-lab-latency-calibration-v1` — per-preset calibration offsets
- `pawdio-lab-latency-ui-v1` — latency page UI prefs
- `pawdio-lab-device-ui-v1` — appearance mode, accent color, bit depth

### Backend — `src-tauri/src/`

- **`main.rs`** (~570 lines) — Tauri command handlers. Thin wrappers; spawn blocking tasks, emit `test-progress` events.
- **`audio/mod.rs`** (~4340 lines) — `AudioEngine` with all DSP: FFT cross-correlation for latency, log-chirp sweep for FR, THD/balance/crosstalk/isolation, real-time input monitor, PNG chart generation (plotters), multi-format export. ANC snapshot capture (`AncSnapshot`, `capture_anc_snapshot`) for per-frequency attenuation across capture modes.

Key Rust crates: `cpal` (audio I/O), `rustfft`, `plotters`, `tokio`, `tauri-plugin-dialog`.

### IPC

Frontend → Tauri via `@tauri-apps/api/core`. All `invoke()` and `listen()` calls live in `src/ipc/commands.ts` (single IPC boundary). `use-pawdio-lab.ts` consumes those wrappers — no other file calls raw `invoke`/`listen`. Long tests emit `test-progress` string events.

## Code Style

Prettier enforced: trailing commas, semicolons, LF line endings. Run `npm run format` before committing.

ESLint (`eslint src`) + typescript-eslint enforce TS rules. Husky + lint-staged run `prettier --write` + `eslint --fix` on staged `.ts/.tsx`, `cargo fmt` on staged `.rs`. `npm run typecheck` for standalone TS check.
