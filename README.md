<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]



<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h1>Pawdio Lab</h1>

  <p align="center">
    Desktop audio diagnostics — measure latency, frequency response, and headphone characteristics with a Rust-powered audio engine and a modern React UI.
    <br />
    <br />
    <a href="https://github.com/Fury7425/pawdio-lab/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/Fury7425/pawdio-lab/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#features">Features</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li>
      <a href="#how-it-works">How It Works</a>
      <ul>
        <li><a href="#latency-measurement">Latency Measurement</a></li>
        <li><a href="#frequency-response-measurement">Frequency Response Measurement</a></li>
        <li><a href="#interpreting-results">Interpreting Results</a></li>
        <li><a href="#experimental-tests">Experimental Tests</a></li>
      </ul>
    </li>
    <li><a href="#exported-files">Exported Files</a></li>
    <li><a href="#project-layout">Project Layout</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

Pawdio Lab is a native desktop application for precise audio path diagnostics. It plays known test signals, records what comes back, and uses FFT-based cross-correlation to measure delay, frequency response, distortion, and channel characteristics — all in real time.

The Rust audio engine handles low-level device I/O and DSP, while the React frontend provides a polished, themeable interface with live visualizations, structured results, and one-click export to multiple formats.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Features

- **Latency Measurement** — Output-to-input delay with 5 signal presets (200 Hz, 1 kHz, 2 kHz, 5 kHz sine + impulse click). Per-preset calibration removes system baseline for meaningful A/B comparisons.
- **Frequency Response** — Logarithmic sweep (20 Hz – 20 kHz configurable) with stereo or mono-guided mode. Exports PNG plots and Squiglink-compatible curves.
- **Input Level Monitor** — Real-time dBFS meter with peak hold, clip detection, and SPL estimate.
- **Pink Noise Generator** — Continuous playback for level checks and placement verification. Live rough FR preview.
- **THD** — Total Harmonic Distortion at configurable tones (2nd–10th harmonic).
- **Channel Balance** — Left vs. right level difference in dB.
- **Crosstalk** — Channel isolation / leakage measurement.
- **Isolation** — Inside vs. outside ambient noise delta.
- **Multi-format Export** — Text reports, CSV, JSON, PNG charts, Squiglink `.txt` curves.
- **Theming** — Dark/light mode with 4 accent colors (blue, teal, purple, greyscale).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![React][React.js]][React-url]
* [![TypeScript][TypeScript]][TypeScript-url]
* [![Tauri][Tauri]][Tauri-url]
* [![Rust][Rust]][Rust-url]
* [![Vite][Vite]][Vite-url]
* [![TailwindCSS][TailwindCSS]][TailwindCSS-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- GETTING STARTED -->
## Getting Started

To get a local copy up and running, follow these steps.

### Prerequisites

* **Node.js** 20+
* **Rust** stable toolchain
* **Linux only** — additional system dependencies:
  ```sh
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev \
    patchelf libasound2-dev
  ```

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/Fury7425/pawdio-lab.git
   ```
2. Install NPM packages
   ```sh
   cd pawdio-lab
   npm install
   ```
3. Start the development app (frontend hot-reload + Rust auto-rebuild)
   ```sh
   npm run dev:tauri
   ```
4. Or build desktop installers (.msi / .app / .AppImage)
   ```sh
   npm run tauri:build
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- USAGE -->
## Usage

1. **Devices / Settings** — Select output/input devices, set sample rates, click Apply
2. **Setup** (Sweep FR page) — Start input monitor, verify no clipping, optionally play pink noise for placement
3. **Run tests** — Latency, Sweep FR, or Experimental tests with your chosen parameters
4. **Export** — Save reports, CSV, JSON, plots, or Squiglink curves from each page's Export menu

Default export path: `~/Documents/Pawdio Lab Exports` (falls back to system temp if unavailable). Override via the Output Folder field on each test page.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server only (no Tauri) |
| `npm run dev:tauri` | Full desktop app with hot reload |
| `npm run build` | TypeScript check + Vite production build |
| `npm run build:fast` | Vite build without type checking |
| `npm run tauri:build` | Build desktop installers |
| `npm run format` | Prettier formatting |
| `npm run release:set` | Update version/name/identifier across config files |
| `npm run release:build` | Update metadata then build |

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- HOW IT WORKS -->
## How It Works

### Latency Measurement

1. Generate a known signal (sine with 10 ms fade envelope, or impulse click)
2. Play and record simultaneously with configurable margin time
3. Resample reference to input rate if sample rates differ
4. Estimate delay via FFT-based cross-correlation with sub-sample parabolic interpolation
5. Repeat N times, report average and standard deviation
6. UI applies per-preset calibration offset to isolate DUT-specific delay

> **Why this approach**: FFT correlation is robust to phase/noise, peak normalization reduces gain sensitivity, and per-preset calibration avoids assuming one offset generalizes across signal shapes.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Frequency Response Measurement

1. Generate a logarithmic chirp (exponential sweep law)
2. Record in stereo, or left/right separately in mono-guided mode
3. Estimate per-channel delay with cross-correlation, then time-align
4. Compute magnitude spectra via FFT for recorded and reference
5. Build response curve on a 200-point log grid: `20 * log10(rec_mag / ref_mag)`
6. Aggregate into left/right/overall averages across repeats

> **Why this approach**: Log spacing matches perceptual resolution, ratioing to the reference isolates transfer characteristics, and explicit delay alignment prevents spectral smearing.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Interpreting Results

**Latency**:
- Lower delay = better for monitoring, instruments, game/AV sync
- Use _calibrated_ delay for comparisons — raw delay includes fixed system overhead
- Low std dev = stable pipeline; high = buffering jitter
- Small negative calibrated values mean recalibration is needed, not negative real latency

**Frequency response**:
- This is a _relative_ transfer curve, not absolute SPL calibration
- 0 dB = same magnitude as reference at that frequency, not "perfectly flat"
- Trust trends across neighboring frequencies; single-bin spikes may be artifacts
- Left/right mismatch usually indicates fit/seal before true driver differences — reseat and remeasure

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Experimental Tests

| Test | Method | Key Metric |
|------|--------|------------|
| **THD** | Play sine, Hann window, FFT, sum harmonic power (2nd–10th) | `THD% = sqrt(sum) / fundamental * 100` |
| **Channel Balance** | Sine on left-only then right-only, compute RMS dBFS | `L_minus_R_dB` |
| **Crosstalk** | Drive one channel, measure leakage on opposite | `crosstalk_dB = 20 * log10(leak / primary)` |
| **Isolation** | Two sequential pink noise captures (inside/outside) | `delta_dB` |

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- EXPORTED FILES -->
## Exported Files

### Latency

| File | Description |
|------|-------------|
| `latency_report_<ts>.txt` | Full text report with per-sound and overall analysis |
| `<preset>_plot_<ts>.png` | Per-sound waveform + correlation plot (optional) |
| `overall_bar_<ts>.png` | Bar chart comparing all presets (optional) |

### Sweep FR

| File | Description |
|------|-------------|
| `sweep_fr_*_<ts>.png` | Left/right/combined/overlay/average plots (7 variants) |
| `squiglink_*_<ts>.txt` | Squiglink-compatible curves (left, right, avg, both) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- PROJECT LAYOUT -->
## Project Layout

```
src/                  React UI (pages, components, state, theme)
src-tauri/            Tauri config + Rust audio engine
  src/main.rs         Command handlers, AudioEngine, stream management
scripts/              Release metadata tooling
app/                  Legacy Python prototype (not active)
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ROADMAP -->
## Roadmap

- [x] Latency measurement with 5 signal presets
- [x] Frequency response sweep with mono-guided mode
- [x] Input level monitor + pink noise generator
- [x] Per-preset calibration system
- [x] Multi-format export (text, CSV, JSON, PNG, Squiglink)
- [x] Dark/light theme with accent color variants
- [ ] Enable experimental test exports
- [ ] Add target curve overlay for FR measurements
- [ ] Waterfall / spectrogram view

See the [open issues](https://github.com/Fury7425/pawdio-lab/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Top contributors

<a href="https://github.com/Fury7425/pawdio-lab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Fury7425/pawdio-lab" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTACT -->
## Contact

Project Link: [https://github.com/Fury7425/pawdio-lab](https://github.com/Fury7425/pawdio-lab)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Tauri](https://tauri.app/) — Desktop framework
* [cpal](https://github.com/RustAudio/cpal) — Cross-platform audio I/O
* [rustfft](https://github.com/ejmahler/RustFFT) — FFT library for Rust
* [plotters](https://github.com/plotters-rs/plotters) — Rust chart generation
* [Lucide](https://lucide.dev/) — Icon library
* [Squiglink](https://squig.link/) — Headphone measurement community format
* [Img Shields](https://shields.io) — README badges

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- TECHNICAL DEEP DIVE -->
<details>
<summary><h2>Technical Deep Dive</h2></summary>

### Calibration Implementation

- UI controller (`src/ui/use-pawdio-lab.ts`) runs raw latency tests per preset and stores `averageDelayMs` as offsets
- Offsets keyed by preset identity (`beep_200`, `beep_1k`, etc.) via `calibrationKeyForRequest`
- Persisted in localStorage key `pawdio-lab-latency-calibration-v1`
- Rust computes raw delay; UI applies calibration via `applyLatencyCalibration`

### Delay Estimation Pipeline

1. Clamp request bounds, initialize input/output devices
2. Generate reference (sine with fade envelope, or impulse at ~10 ms offset in 256+ sample buffer)
3. Start input stream, then output stream; capture for `duration + margin` seconds
4. Resample reference with `resample_linear` if rates differ
5. `find_delay_ms`: normalize both signals, zero-pad to next power of 2, FFT correlation, find max absolute lag, refine with 3-point parabolic interpolation, convert to ms
6. Repeat, emit progress events, compute summary from successful runs

### Sweep FR Pipeline

1. Build 200-point log frequency grid, generate exponential chirp with fade envelope
2. Capture: stereo (split channels) or mono (per-side routing)
3. Per-channel delay estimation + integer-sample alignment
4. FFT both, ratio magnitudes at each grid frequency: `20 * log10(rec / ref)`
5. Aggregate all curves into left/right/overall averages

### Persistence

UI state and calibration data are stored in `localStorage`:

| Key | Contents |
|-----|----------|
| `pawdio-lab-ui-state-v1` | Active page, device selections, test parameters |
| `pawdio-lab-latency-calibration-v1` | Per-preset calibration offsets |
| `pawdio-lab-latency-ui-v1` | Latency page UI preferences |
| `pawdio-lab-device-ui-v1` | Appearance mode, accent color, bit depth |

### macOS Signing

CI supports full signing/notarization via GitHub secrets (`APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). Without these, builds fall back to ad-hoc signing.

If a downloaded build is quarantined:

```sh
xattr -dr com.apple.quarantine "/Applications/Pawdio Lab.app"
```

</details>



<!-- KOREAN DOCS -->
<details>
<summary><h2>기술 설명 (Korean)</h2></summary>

### 캘리브레이션이 필요한 이유

측정 지연에는 OS 믹서, 드라이버 버퍼, 코덱 DSP, 무선 스택, ADC/DAC 경로가 모두 포함됩니다. 캘리브레이션은 이 고정 오버헤드를 빼서 비교 가능한 "추가 지연"을 보여줍니다. 프리셋별로 저장하는 이유는 신호 형태마다 상관 기반 정렬 특성이 다르기 때문입니다.

### 지연 측정

알려진 기준 신호를 재생/녹음 동시 수행 후, FFT 상관 분석으로 오프셋을 추정합니다. 포물선 보간으로 정수 샘플 해상도를 넘는 정밀도를 확보하고, 여러 번 반복 후 평균과 표준편차를 보고합니다.

### 주파수 응답 측정

로그 스윕(chirp)을 재생/녹음하고 시간 정렬 후 주파수별 레벨 비율(`20 * log10(rec/ref)`)을 계산합니다. 200포인트 로그 그리드는 청감 해상도와 맞고 저역 정보를 촘촘하게 제공합니다.

### 결과 해석

- 지연: 낮을수록 유리, 비교시 보정(calibrated) 값 사용, 표준편차가 안정성 지표
- 주파수 응답: 상대 전달 특성 곡선이므로 절대값보다 형태와 좌우 차이를 해석
- 좌우 불일치는 착용/실링 차이가 원인인 경우가 많아 재착용 후 재측정 권장

### 구현 설계 이유

- FFT 상관: 중간~긴 버퍼에서 효율적이고 위상/노이즈에 안정적
- 피크 정규화: 입력 게인 변화 민감도 감소
- 프리셋별 보정: 신호 형태 차이 바이어스 제거
- 최근접 빈 샘플링/무스무딩: 재현성과 디버깅 용이성 확보

</details>



<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/Fury7425/pawdio-lab.svg?style=for-the-badge
[contributors-url]: https://github.com/Fury7425/pawdio-lab/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Fury7425/pawdio-lab.svg?style=for-the-badge
[forks-url]: https://github.com/Fury7425/pawdio-lab/network/members
[stars-shield]: https://img.shields.io/github/stars/Fury7425/pawdio-lab.svg?style=for-the-badge
[stars-url]: https://github.com/Fury7425/pawdio-lab/stargazers
[issues-shield]: https://img.shields.io/github/issues/Fury7425/pawdio-lab.svg?style=for-the-badge
[issues-url]: https://github.com/Fury7425/pawdio-lab/issues
[license-shield]: https://img.shields.io/github/license/Fury7425/pawdio-lab.svg?style=for-the-badge
[license-url]: https://github.com/Fury7425/pawdio-lab/blob/main/LICENSE
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Tauri]: https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white
[Tauri-url]: https://tauri.app/
[Rust]: https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white
[Rust-url]: https://www.rust-lang.org/
[Vite]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[Vite-url]: https://vite.dev/
[TailwindCSS]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[TailwindCSS-url]: https://tailwindcss.com/
