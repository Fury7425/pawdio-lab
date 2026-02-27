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

## Calibration, Delay, and Frequency Response (Explainers)
<details>
<details>
<summary>Audio-focused explanation (what it does, why it does it, how to read it)</summary>

**Why calibration exists**
- The measured delay includes your whole signal path: OS mixer, driver buffering, codec DSP, wireless stack, and ADC/DAC pipeline.
- That baseline is often stable but not meaningful when you are comparing headphones/settings. Calibration removes it so you can compare the *extra* delay from what you are testing.
- Calibration is per preset (200 Hz / 1 kHz / 2 kHz / 5 kHz / impulse), because different test sounds can lock differently in correlation.
- In practice, calibration is measured by running selected presets multiple times and storing each preset's baseline average.

**How the program measures delay**
- It generates a known signal (sine with short fade-in/out, or impulse click), plays it, and records simultaneously.
- The recording window intentionally includes extra margin time so late arrivals are still captured.
- It lines the recording up to the reference by correlation and converts that offset into milliseconds.
- It repeats the run several times and reports both average delay and variation.

**How to interpret delay**
- Lower is better for monitoring, instrument practice, or game/AV sync.
- Use calibrated delay for comparisons. Raw delay includes fixed system overhead that can hide real differences.
- Standard deviation is stability: low = consistent pipeline, high = buffering jitter/unstable route.
- Very small negative calibrated values can happen if the saved baseline is slightly higher than current conditions; this usually means recalibration is needed, not "negative real latency."
- Compare like-for-like: same preset, same sample rates, same routing, same placement.

**How the program measures frequency response**
- It plays a logarithmic sweep (chirp) from low to high frequency and records what comes back.
- It aligns recording and reference in time first (delay compensation), then compares level by frequency bin.
- It outputs a relative dB curve: recorded level vs reference level across the requested range.
- In mono guided mode, left and right are measured in separate passes so you can physically reposition between channels.

**How to interpret frequency response**
- Peaks/dips show emphasis or attenuation at those regions.
- This is a relative transfer curve, not absolute SPL calibration. Treat shape and channel deltas as primary signals.
- 0 dB at a point means "same bin magnitude as reference," not "perfectly flat headphone target."
- Single-bin spikes can be measurement artifacts; trust persistent trends across neighboring frequencies.
- Left/right mismatch often indicates fit/seal/position mismatch before true driver mismatch, so repeat with careful reseating.
</details>

<details>
<summary>Technical explanation (how the code works, and why)</summary>

**Why calibration exists (implementation)**
- Calibration baselines are built in the UI controller (`src/ui/use-pawdio-lab.ts`) by running raw latency tests per selected preset and storing `averageDelayMs` as per-sound offsets.
- Offsets are keyed by preset identity (`beep_200`, `beep_1k`, `beep_2k`, `beep_5k`, `impulse`) via `calibrationKeyForRequest`.
- Offsets persist in local storage key `pawdio-lab-latency-calibration-v1`.
- Runtime latency calculation in Rust is raw; calibration is applied in the UI by `applyLatencyCalibration`, which subtracts the offset from each measurement and recomputes mean/stddev.
- `calibrated_offset_ms` is still passed in request/export metadata so text reports can show what offset was applied.

**How delay is measured (implementation)**
1. Clamp request bounds (`repeats`, `duration`, `amplitude`, `record_margin_secs`) and initialize runtime with selected input/output devices.
2. Generate reference:
   - Sine: tapered 10 ms fade-in/fade-out envelope.
   - Impulse: one-sample click placed ~10 ms after start in a minimum 256-sample buffer.
3. Play and record:
   - Input stream is started, then output stream is started.
   - Capture length is fixed to `record_duration_secs * input_sample_rate`.
   - For latency runs, `record_duration_secs = duration + record_margin_secs`.
   - A short guard sleep is added before streams are paused.
4. If output and input sample rates differ, reference is converted with linear interpolation (`resample_linear`) to input rate.
5. Delay estimator (`find_delay_ms`):
   - Normalize recorded/reference by their peak absolute value.
   - Zero-pad both to `n = next_power_of_two(len(recorded) + len(reference))`.
   - FFT both signals, multiply by conjugate spectrum, inverse FFT to correlation.
   - Search non-negative lag region, pick max absolute real correlation.
   - Refine peak with 3-point parabolic interpolation (fractional-sample estimate).
   - Convert lag samples to milliseconds.
6. Repeat per iteration, emit progress events, then compute summary from successful (non-`None`) runs only.
7. UI calibration subtracts per-sound baseline afterward and stores calibrated entries for result panels and exports.

**Why this approach**
- FFT-based correlation scales well for medium/long captures and is robust to phase differences compared with naive peak picking.
- Peak normalization reduces level sensitivity when capture gain changes.
- Fractional interpolation improves precision beyond integer-sample granularity without expensive model fitting.
- Separate per-sound calibration avoids assuming one offset generalizes across all signal shapes.

**How frequency response is measured (implementation)**
1. Clamp sweep request (`f0`, `f1`, `duration`, `amplitude`, `repeats`) and build a 200-point logarithmic frequency grid.
2. Generate logarithmic chirp:
   - Uses exponential sweep law with `k = ln(f1/f0)/duration`.
   - Applies ~10 ms fade-in/out to reduce edge transients.
3. Capture strategy:
   - Stereo mode: one playback routed to both channels, then split captured channels.
   - Mono mode: route left-only or right-only per run (`mono_side`) and capture each side separately.
   - Sweep capture uses `duration + 0.5s` margin.
4. Resample chirp reference to input sample rate when output/input rates differ.
5. Estimate per-channel delay with same correlation method as latency test.
6. Align each channel by integer sample shift derived from delay (`align_to_reference`), trimming/padding to reference length.
7. Build FR curve (`frequency_response_curve`):
   - FFT length: `max(len(recorded), len(reference)).next_power_of_two().max(1024)`.
   - Compute magnitude spectra (`sqrt(re^2 + im^2)`) for recorded and reference.
   - For each grid frequency, pick nearest FFT bin and compute `20 * log10(rec_mag / ref_mag)`.
8. Aggregate:
   - Keep all curves per side.
   - Compute left average, right average, and global average across all non-empty curves.
   - Report average left/right delays in metrics and optionally export plots + Squiglink files.

**Why this approach**
- Log spacing matches perceptual resolution and gives denser low-frequency insight than linear spacing.
- Ratioing to the known reference reduces dependence on source amplitude and emphasizes transfer behavior of the DUT path.
- Explicit delay alignment before FFT ratio avoids smearing from time offset.
- The implementation intentionally stays simple and deterministic (nearest-bin sampling, no smoothing), which is easier to audit and compare run-to-run.
</details>
</details>

## 캘리브레이션, 지연시간, 응답그래프
<details>
<details>
<summary>오디오 중심 설명 (무엇을 측정하고, 왜 그렇게 만들었고, 어떻게 해석하는지)</summary>

**캘리브레이션이 필요한 이유**
- 지연 측정값에는 OS 믹서, 드라이버 버퍼, 코덱 DSP, 무선 스택, ADC/DAC 경로가 모두 포함됩니다.
- 이 기본 지연은 비교 실험(헤드폰/설정 변경)에서는 노이즈가 될 수 있으므로, 캘리브레이션으로 빼서 "추가 지연"을 보기 쉽게 만듭니다.
- 캘리브레이션은 프리셋별(200 Hz / 1 kHz / 2 kHz / 5 kHz / 임펄스)로 저장됩니다. 신호 형태마다 상관 기반 정렬 특성이 다르기 때문입니다.
- 실제로는 선택한 프리셋을 여러 번 돌려 각 프리셋 평균 지연을 베이스라인으로 저장합니다.

**지연(Delay)을 어떻게 측정하는지**
- 알려진 기준 신호(페이드가 들어간 사인 또는 임펄스 클릭)를 생성하고 재생과 녹음을 동시에 수행합니다.
- 녹음 시간에 여유 마진을 더해 늦게 도착한 신호도 캡처합니다.
- 녹음 신호와 기준 신호를 상관 분석으로 정렬해 오프셋을 ms로 변환합니다.
- 여러 번 반복한 뒤 평균과 분산(표준편차)을 함께 보여줍니다.

**지연 결과 해석법**
- 모니터링, 악기 연주, 게임/영상 싱크 관점에서는 낮을수록 유리합니다.
- 비교에는 보정된(calibrated) 지연을 우선 보세요. 원시(raw) 지연에는 시스템 고정 오버헤드가 섞입니다.
- 표준편차는 안정성 지표입니다. 낮으면 안정, 높으면 버퍼링 지터/라우팅 불안정 가능성이 큽니다.
- 보정 후 아주 작은 음수 값은 저장된 베이스라인이 현재 환경보다 약간 큰 경우에 발생할 수 있으며, 보통 재캘리브레이션 신호입니다.
- 프리셋, 샘플레이트, 라우팅, 마이킹 위치를 동일하게 맞춘 상태에서 비교해야 의미가 있습니다.

**주파수 응답(FR)을 어떻게 측정하는지**
- 저역부터 고역까지 로그 스윕(치irp)을 재생하고 결과를 녹음합니다.
- 먼저 시간축 정렬(지연 보정)을 수행한 뒤, 주파수별 레벨 비를 계산합니다.
- 출력은 상대 dB 곡선(녹음 레벨 / 기준 레벨)입니다.
- 모노 가이드 모드에서는 좌/우를 분리 측정하므로 채널별 물리 위치를 다시 맞출 수 있습니다.

**주파수 응답 해석법**
- 피크/딥은 해당 대역의 강조/감쇠를 의미합니다.
- 이 값은 절대 SPL 보정 곡선이 아니라 상대 전달 특성 곡선입니다. 절대값보다 형태와 좌우 차이를 보세요.
- 특정 지점의 0 dB는 "기준 신호와 같은 빈 크기"를 뜻하며, 타깃 기준의 완전 평탄을 뜻하지는 않습니다.
- 한두 빈의 뾰족한 스파이크는 아티팩트일 수 있어 인접 대역까지 이어지는 추세를 우선 해석하는 것이 안전합니다.
- 좌우 불일치는 실제 드라이버 차이보다 착용/실링/포지션 차이에서 먼저 발생하는 경우가 많아 재착용 후 재측정을 권장합니다.
</details>

<details>
<summary>기술 중심 설명 (코드 관점에서 어떻게 동작하고 왜 그렇게 설계했는지)</summary>

**캘리브레이션 구현 구조**
- UI 컨트롤러(`src/ui/use-pawdio-lab.ts`)에서 프리셋별 raw 지연 테스트를 돌린 뒤 `averageDelayMs`를 per-sound 오프셋으로 저장합니다.
- 키 매핑은 `calibrationKeyForRequest`로 `beep_200`, `beep_1k`, `beep_2k`, `beep_5k`, `impulse`를 사용합니다.
- 오프셋은 localStorage 키 `pawdio-lab-latency-calibration-v1`에 유지됩니다.
- Rust 런타임 지연 계산은 raw이고, UI의 `applyLatencyCalibration`이 각 측정치에서 오프셋을 빼고 평균/표준편차를 다시 계산합니다.
- `calibrated_offset_ms`는 결과/리포트 메타데이터에 함께 전달되어 텍스트 리포트에서 적용 오프셋을 표시할 수 있습니다.

**지연 측정 파이프라인**
1. 요청값(`repeats`, `duration`, `amplitude`, `record_margin_secs`)을 안전 범위로 clamp하고 런타임을 초기화합니다.
2. 기준 신호 생성:
   - 사인: 약 10 ms 페이드 인/아웃 엔벨로프 적용.
   - 임펄스: 최소 256 샘플 버퍼에 시작 후 약 10 ms 지점에 1샘플 클릭 배치.
3. 재생/녹음:
   - 입력 스트림 먼저 시작, 그 다음 출력 스트림 시작.
   - 캡처 길이는 `record_duration_secs * input_sample_rate` 프레임.
   - 지연 테스트에서는 `record_duration_secs = duration + record_margin_secs`.
   - 종료 전 짧은 guard sleep을 둔 뒤 스트림 pause.
4. 입출력 샘플레이트가 다르면 `resample_linear`(선형 보간)로 기준 신호를 입력 레이트에 맞춥니다.
5. `find_delay_ms` 알고리즘:
   - 녹음/기준 신호를 각 peak 절대값으로 정규화.
   - `n = next_power_of_two(len(recorded) + len(reference))`로 zero-padding.
   - FFT -> 켤레곱 -> IFFT로 상관 함수 계산.
   - 비음수 lag 구간에서 절대 상관 최대 지점 탐색.
   - 3점 포물선 보간으로 fractional-sample 피크 보정.
   - 샘플 오프셋을 ms로 변환.
6. 반복 측정 후 성공(`None`이 아닌) 결과만으로 통계 요약 및 진행 이벤트 emit.
7. UI가 프리셋 오프셋을 후처리로 적용해 최종 calibrated 결과를 저장/표시/내보냅니다.

**이 방식으로 만든 이유**
- FFT 기반 상관은 중간~긴 버퍼에서 효율이 좋고 단순 피크 탐색보다 위상/노이즈 조건에서 안정적입니다.
- 피크 정규화로 입력 게인 변화에 대한 민감도를 낮춥니다.
- 포물선 보간으로 정수 샘플 해상도 한계를 넘는 정밀도를 낮은 계산비용으로 확보합니다.
- 프리셋별 보정을 분리해 신호 형태 차이에 따른 바이어스를 줄입니다.

**주파수 응답 측정 파이프라인**
1. sweep 요청(`f0`, `f1`, `duration`, `amplitude`, `repeats`)을 clamp하고 200포인트 로그 주파수 그리드를 생성합니다.
2. 로그 chirp 생성:
   - `k = ln(f1/f0)/duration` 기반 지수 스윕 위상식 사용.
   - 경계 트랜지언트 감소를 위해 약 10 ms 페이드 인/아웃 적용.
3. 캡처 전략:
   - 스테레오 모드: 양 채널 재생 후 캡처 채널 분리.
   - 모노 모드: `mono_side`에 따라 좌/우 단독 라우팅으로 개별 측정.
   - sweep 캡처 길이는 `duration + 0.5s`.
4. 입출력 레이트 불일치 시 chirp 기준 신호를 입력 레이트로 리샘플링.
5. 채널별 지연은 latency와 동일한 상관 방식으로 추정.
6. `align_to_reference`에서 지연 기반 정수 샘플 시프트로 참조 길이에 맞춰 정렬/잘라내기.
7. `frequency_response_curve` 계산:
   - FFT 길이: `max(len(recorded), len(reference)).next_power_of_two().max(1024)`.
   - recorded/reference의 magnitude spectrum 계산.
   - 로그 그리드 각 주파수를 최근접 FFT bin에 매핑해 `20 * log10(rec_mag / ref_mag)` 계산.
8. 집계:
   - 좌/우 all curves 유지.
   - 좌 평균, 우 평균, 전체 평균 계산.
   - metrics에 좌/우 평균 지연을 넣고, 옵션에 따라 플롯/스퀴글링크 파일을 저장.

**이 방식으로 만든 이유**
- 로그 간격은 청감 해상도와 맞고 저역 정보를 선형 간격보다 촘촘하게 제공합니다.
- 기준 대비 비율 계산은 절대 출력 레벨 영향 일부를 줄이고 DUT 전달 특성 변화를 강조합니다.
- FFT 비율 전에 시간 정렬을 수행해 지연으로 인한 스펙트럼 번짐을 줄입니다.
- 구현을 최근접 빈 샘플링/무스무딩으로 단순화해 재현성과 디버깅 용이성을 높였습니다.
</details>
</details>

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

### macOS Installer Notes

If macOS shows:
- `"Pawdio Lab" is damaged and can't be opened`

use a signed/notarized build. CI supports this through GitHub secrets:
- `APPLE_SIGNING_IDENTITY` (Developer ID Application identity)
- `APPLE_CERTIFICATE` (base64 `.p12`)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

If those secrets are not configured, CI/local builds now fall back to ad-hoc signing (`signingIdentity: "-"`) to avoid broken unsigned bundles.

For already-downloaded older builds that are quarantined:

```bash
xattr -dr com.apple.quarantine "/Applications/Pawdio Lab.app"
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




