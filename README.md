# Pawdio Lab

Pawdio Lab is a desktop audio diagnostics app for measuring latency, frequency response, and several experimental headphone/channel metrics.

## Active Runtime

This repository contains two implementations:

- Active app: React + TypeScript UI (`src/`) + Tauri 2 + Rust audio engine (`src-tauri/`)
- Legacy prototype: Python + CustomTkinter (`app/`)

The active runtime is the Tauri app.

## What the App Does

- Measures output-to-input latency with selectable test signals and calibration offsets
- Runs logarithmic sweep-based frequency response measurements with optional mono guided mode
- Provides setup tools (input level monitor + pink noise playback)
- Runs experimental tests: channel balance, crosstalk, THD, and isolation
- Stores structured results/logs and exports latency/sweep artifacts

## Test Catalog (What Each Test Does and How)

### 1. Latency Test

What it measures:
- Delay between played signal and recorded signal in milliseconds

Signals:
- 200 Hz sine, 1 kHz sine, 2 kHz sine, 5 kHz sine, and impulse presets

How it works:
1. Generate a test signal (sine/impulse/pink noise generator exists; latency presets use sine + impulse).
2. Play signal and record input at the same time.
3. If output and input sample rates differ, resample the reference signal to input rate.
4. Estimate delay using FFT-based cross-correlation.
5. Refine the peak with sub-sample parabolic interpolation.
6. Repeat `N` times, then compute average and standard deviation from successful runs.
7. UI calibration subtracts the per-sound offset from each measured delay.

Outputs:
- Per-iteration delay values
- Average delay and std dev
- Optional per-sound plot PNG (reference, recording, correlation)
- Optional overall bar chart PNG
- Exportable text report with per-sound and overall analysis

### 2. Sweep FR (Frequency Response)

What it measures:
- Relative frequency response curve across a configurable band (default 20 Hz to 20 kHz)

How it works:
1. Generate a logarithmic chirp.
2. Record response in stereo (or one side at a time in mono mode).
3. Estimate delay per side with cross-correlation and align to reference.
4. Compute FFT magnitude spectra for recorded and reference signals.
5. Build response curve on a 200-point log frequency grid using:
   - `20 * log10(recorded_mag / reference_mag)`
6. Aggregate per-run curves into left/right and overall averages.

Mono mode behavior:
- UI guided mode runs LEFT then RIGHT as two sequential sweeps and merges payloads.

Outputs:
- JSON payload with curves and delay metrics
- Optional PNG plots:
  - left avg / left all
  - right avg / right all
  - combined all sweeps
  - left-right avg overlay
  - average of all sweeps
- Optional Squiglink text exports:
  - left, right, avg, and both-channel formats

### 3. THD (Total Harmonic Distortion)

What it measures:
- Harmonic distortion percentage at configured tones (default 100, 1000, 6000 Hz)

How it works:
1. Play sine tone and record capture.
2. Apply Hann window.
3. FFT to magnitude spectrum.
4. Find fundamental magnitude.
5. Sum harmonic power (2nd through 10th harmonic within Nyquist).
6. Compute:
   - `THD% = sqrt(sum(harmonic_power)) / fundamental * 100`

Outputs:
- Per-tone THD percent list in result metrics

### 4. Channel Balance

What it measures:
- Relative level difference between left and right channels

How it works:
1. Play sine on left-only route and record.
2. Play sine on right-only route and record.
3. Compute RMS -> dBFS for each recording.
4. Report `L_minus_R_dB`.

Outputs:
- `left_dBFS`, `right_dBFS`, `L_minus_R_dB`

### 5. Crosstalk

What it measures:
- Leakage from a driven channel into the opposite channel

How it works:
1. Play sine on one channel (L->R or R->L direction).
2. Record both channels where available.
3. Treat driven side as primary and opposite as leak.
4. Compute RMS of both.
5. Compute:
   - `crosstalk_dB = 20 * log10(leak_rms / primary_rms)`

Interpretation:
- More negative dB usually means lower leakage (better isolation between channels).

Outputs:
- `primary_rms`, `leak_rms`, `crosstalk_dB`

### 6. Isolation (Inside vs Outside)

What it measures:
- Difference in recorded pink-noise level between two captures labeled inside/outside

How it works:
1. Generate pink noise.
2. Perform first capture (`inside`).
3. Perform second capture (`outside`).
4. Convert each to dBFS and report delta.

Outputs:
- `inside_dBFS`, `outside_dBFS`, `delta_dB`

Note:
- In the current Tauri implementation, this runs as two immediate sequential captures without a UI pause prompt.

## Setup Tools Used During Testing

### Input Level Monitor

- Streams input continuously and reports:
  - current dBFS
  - peak dBFS
  - clip count
- Clip detection threshold is near full-scale amplitude (`abs(sample) >= 0.98`).

### Pink Noise Playback

- Continuous pink noise generator (Paul Kellet-style filter state) for level/setup checks.

## Tech Stack (What It Uses)

Frontend:
- React 18
- TypeScript
- Vite
- Tauri JS API

Desktop shell:
- Tauri 2

Rust audio engine:
- `cpal` for device IO/streams (WASAPI host on Windows)
- `rustfft` for FFT/correlation/spectral work
- `plotters` for PNG charts
- `serde`/`serde_json` for payloads
- `tokio` for async coordination

Legacy Python prototype (not active runtime):
- `numpy`, `scipy`, `matplotlib`, `pyaudio`, `customtkinter`

## How to Run

### Prerequisites

- Node.js 20+
- npm
- Rust stable toolchain

Linux Tauri system dependencies:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libasound2-dev
```

### Start the Active Tauri App

```bash
npm install
npm run tauri dev
```

### Build Desktop Bundles

```bash
npm run tauri build
```

### Optional: Run Legacy Python Prototype

```bash
pip install -r requirements.txt
python app/main.py
```

## How to Use (Typical Workflow)

1. Open `Devices / Settings`
   - Pick output/input devices
   - Set sample rates/chunk size
   - Click `Apply`
2. Optional setup in `Sweep FR`
   - Start input monitor and verify no clipping
   - Play pink noise for placement checks
3. Run tests
   - `Latency`: choose presets, repeats, calibration options, run selected/all
   - `Sweep FR`: configure range/duration/repeats, optional mono mode, run sweep
   - `Experimental`: run Balance/Crosstalk/THD/Isolation as needed
4. View outputs
   - `Results / Export` for JSON payloads + runtime logs
   - `Latency` page to export text report

## Exported Files

If `Output Folder` is empty, files are written to the app's current working directory.

Latency:
- `latency_report_<timestamp>.txt`
- `<preset>_plot_<timestamp>.png` (if enabled)
- `overall_bar_<timestamp>.png` (if enabled)

Sweep FR:
- `sweep_fr_left_avg_<timestamp>.png`
- `sweep_fr_left_all_<timestamp>.png`
- `sweep_fr_right_avg_<timestamp>.png`
- `sweep_fr_right_all_<timestamp>.png`
- `sweep_fr_all_<timestamp>.png`
- `sweep_fr_lr_avg_<timestamp>.png`
- `sweep_fr_avg_all_<timestamp>.png`
- `squiglink_left_<timestamp>.txt`
- `squiglink_right_<timestamp>.txt`
- `squiglink_avg_<timestamp>.txt`
- `squiglink_both_<timestamp>.txt`

## Persistence

UI and calibration preferences are persisted in local storage, including:

- `pawdio-lab-ui-state-v1`
- `pawdio-lab-latency-calibration-v1`
- `pawdio-lab-latency-ui-v1`
- `pawdio-lab-device-ui-v1`

## Project Layout

- `src/` - React UI pages, controller, theme/state handling
- `src-tauri/` - Tauri commands + Rust audio engine
- `app/` - Legacy Python prototype and legacy test modules

## Current Limitations

- `Browse` buttons for output folder are currently UI placeholders.
- Sweep/experimental export buttons shown in UI are currently disabled placeholders.
- Experimental tests are functional but still under an `Experimental` page toggle.
