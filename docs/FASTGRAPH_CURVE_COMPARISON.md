# Fastgraph-Inspired Curve Comparison

## What changed

Pawdio Lab's Library comparison view gained three non-destructive analysis tools inspired by [DMS Fastgraph](https://github.com/DMS3tv/fastgraph):

- **Fractional-octave smoothing**: Off, 1/48, 1/24, 1/12, 1/6, or 1/3 octave. A Gaussian window is applied on the log-frequency axis.
- **Delta vs first**: the first selected measurement becomes the reference and is subtracted from every later selection. Positive values mean the compared curve is above the reference.
- **Variation band** for frequency-response records: p10-p90 outer fill, p25-p75 inner fill, and a median line on a shared 600-point logarithmic grid.

All transforms are view-only. Database records and raw measurement payloads are never modified.

## How to use it

1. Save at least two FR or ANC measurements in **Library**.
2. Select measurements of the same type. Selection order determines the delta reference.
3. Choose smoothing, channel, normalization, delta, or variation controls above the comparison graph.

For FR data, processing order is normalization at an interpolated 1 kHz value, smoothing, then delta or percentile aggregation. ANC supports smoothing and delta; variation bands are limited to FR.

## Implementation

| File | Responsibility |
| --- | --- |
| `src/ui/lib/curve-processing.ts` | Log interpolation, exact normalization, smoothing, delta subtraction, and percentile aggregation |
| `src/ui/pages/compare/compare-curves.tsx` | Comparison state, controls, and view-only processing pipeline |
| `src/ui/components/overlay-chart.tsx` | Outer/inner shaded envelopes and median rendering |
| `src/ui/lib/chart-scale.ts` | Closed SVG band-path construction |
| `src/ui/lib/export-files.ts` | Shared timestamped downloads, safe CSV quoting, and flattened record export |
| `src/index.css` | Compact comparison controls and mode notes |
| `src/ui/__tests__/curve-processing.test.ts` | Pure DSP utility coverage |
| `src/ui/__tests__/chart-scale.test.ts` | SVG band-path coverage |
| `src/ui/__tests__/export-files.test.ts` | CSV escaping, flattening, and timestamp coverage |

The design follows Fastgraph's useful separation between raw session curves and presentation-time processing. Relevant references are its [`processing.py`](https://github.com/DMS3tv/fastgraph/blob/main/dms/processing.py), [`measurement_txt.py`](https://github.com/DMS3tv/fastgraph/blob/main/dms/measurement_txt.py), and [`hrtf.py`](https://github.com/DMS3tv/fastgraph/blob/main/dms/hrtf.py).

## Verification status

- The patch passed `git diff --check`.
- Tests were written but intentionally not executed.
- The application, TypeScript build, Rust code, and audio devices were not run, following the implementation constraint for this work.

## JSON and CSV export coverage

- **Sweep FR**: last/all JSON and last-result CSV.
- **Latency**: CSV.
- **ANC**: complete JSON with raw captures and derived attenuation, plus long-form CSV with left, right, and average attenuation.
- **Experimental tests**: session JSON and flattened CSV for balance, crosstalk, THD, and isolation results.
- **Library**: selected records of any test type as complete JSON or flattened CSV.
- **Comparison view**: the currently displayed overlay, delta, or variation result as JSON or long-form CSV, including normalization and smoothing metadata and percentile columns.

CSV string fields are quoted as needed and spreadsheet formula prefixes are neutralized. JSON bundles include a format name, schema version, generation timestamp, and relevant processing metadata.

## Recommended next improvements

### UI and workflow

1. **Make the reference explicit**: allow pinning or reordering the delta reference instead of relying only on selection order.
2. **Group graph controls**: separate Channel, Processing, and View controls; add a one-click Reset and persist preferences per comparison type.
3. **Improve the Library**: add search, tags, sorting, notes, and multi-select actions. Show selected records in an ordered comparison tray.
4. **Add transformed export**: export the visible smoothed/delta/variation curve with a header describing every applied transform.
5. **Add TXT import and compensation**: accept permissive REW/Squiglink two-column text, then support target or fixture/HRTF subtraction without changing raw records.
6. **Strengthen accessibility**: test modal focus trapping, visible focus, screen-reader labels, reduced motion, keyboard-only chart controls, and high-contrast band fills.
7. **Audit text encoding**: normalize tracked text files to UTF-8 and replace any mojibake already visible in labels or documentation.

### Security and data integrity

Existing strengths include a restrictive CSP, minimal Tauri capabilities, parameterized SQL, and rejection of relative or `..` export paths.

1. **Sanitize every filename component**: `save_anc_plots` currently uses renderer-supplied mode keys and timestamps in filenames. Restrict these values to safe characters and length before joining paths.
2. **Authorize export locations**: absolute-path validation still permits any location writable by the process and does not prevent symlink escapes. Prefer a directory selected through the dialog, store its canonical path in Rust state, and restrict subsequent writes to that directory.
3. **Validate IPC payloads in Rust**: cap curve counts and point counts; reject non-finite values, mismatched arrays, invalid frequency ordering, oversized JSON payloads, unknown test types, and overlong names or labels.
4. **Use safe writes**: write exports to a temporary file and atomically rename; require explicit overwrite confirmation or create-new semantics.
5. **Reduce CSP exceptions**: move remaining inline styles into classes so `style-src 'unsafe-inline'` can eventually be removed.
6. **Sign production builds**: replace unsigned macOS packaging and configure platform signing plus verified updates before distributing broadly.
7. **Redact diagnostics**: provide a privacy-safe log-copy mode that removes full paths and device identifiers before users share reports.

### Maintainability

- Split `src-tauri/src/audio/mod.rs` into device I/O, signal generation, alignment, analysis, plotting, and export modules.
- Keep new DSP transforms pure and independently tested, as done by `curve-processing.ts`.
- Add property tests for interpolation, percentile ordering, finite output, and invariance of raw records.
- Version exported/session schemas so future target, HRTF, metadata, and R&D workspace features remain backward compatible.
