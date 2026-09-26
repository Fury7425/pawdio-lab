use std::{
    f32::consts::PI,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime},
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, Host, SampleFormat, SampleRate, Stream, StreamConfig,
};
use plotters::prelude::*;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

pub mod alignment;

use alignment::{
    align_recording, build_measurement_layout, AlignedMeasurement, AlignmentDiagnostics,
    AlignmentSettings, MeasurementProfile,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub output_device_index: Option<usize>,
    pub input_device_index: Option<usize>,
    /// Name of the selected output. Enumeration order moves when a device is
    /// plugged in or removed, so the index alone can come to name a different
    /// device; the name is what identifies it.
    #[serde(default)]
    pub output_device_name: Option<String>,
    #[serde(default)]
    pub input_device_name: Option<String>,
    pub output_sample_rate: u32,
    pub input_sample_rate: u32,
    pub duration_secs: f32,
    pub chunk_size: u32,
    #[serde(default)]
    pub item_name: String,
    /// Wireless capture mode.
    ///
    /// A Bluetooth link resamples and buffers, so its clock never matches the
    /// capture clock exactly. Turning this on wraps every excitation in timing
    /// markers, widens the silences around it, and measures the drift so the
    /// recorded window can be corrected before analysis.
    ///
    /// The latency test deliberately ignores this flag. Its entire job is to
    /// report the delay a link adds, and marker-locked alignment would remove
    /// the very quantity it exists to measure.
    #[serde(default)]
    pub bluetooth_mode: bool,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            output_device_index: None,
            input_device_index: None,
            output_device_name: None,
            input_device_name: None,
            output_sample_rate: 44_100,
            input_sample_rate: 44_100,
            duration_secs: 0.5,
            chunk_size: 1024,
            item_name: String::new(),
            bluetooth_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub index: usize,
    pub name: String,
    pub is_input: bool,
    pub channels: u16,
    pub default_sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInventory {
    pub inputs: Vec<AudioDeviceInfo>,
    pub outputs: Vec<AudioDeviceInfo>,
    pub default_input_index: Option<usize>,
    pub default_output_index: Option<usize>,
}

/// Latency excitation. A one-octave log chirp centred on the request's
/// frequency: band-limited enough to probe one region of the spectrum, and
/// swept so its correlation has a single unambiguous peak, which a steady tone
/// does not.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TestSignalKind {
    Chirp,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyTestRequest {
    pub signal: TestSignalKind,
    pub frequency_hz: f32,
    pub duration_secs: f32,
    pub amplitude: f32,
    pub repeats: u32,
    pub record_margin_secs: f32,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default = "default_true")]
    pub save_per_sound_plot: bool,
    #[serde(default = "default_true")]
    pub save_overall_bar_chart: bool,
    #[serde(default)]
    pub calibrated_offset_ms: f32,
    /// Optional: when running multiple presets in a suite, pass a pre-created
    /// output directory to save all results in one folder instead of separate folders
    #[serde(default)]
    pub shared_output_dir: Option<String>,
    /// Optional: shared run tag (timestamp string) so all presets in a suite
    /// resolve to the same output folder without needing a pre-existing directory.
    #[serde(default)]
    pub shared_run_tag: Option<String>,
}

impl Default for LatencyTestRequest {
    fn default() -> Self {
        Self {
            signal: TestSignalKind::Chirp,
            frequency_hz: 5000.0,
            duration_secs: 0.5,
            amplitude: 0.85,
            repeats: 5,
            record_margin_secs: 1.0,
            output_dir: None,
            save_per_sound_plot: true,
            save_overall_bar_chart: true,
            calibrated_offset_ms: 0.0,
            shared_output_dir: None,
            shared_run_tag: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepFrRequest {
    pub f0: f32,
    pub f1: f32,
    pub duration_secs: f32,
    pub repeats: u32,
    pub amplitude: f32,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default = "default_true")]
    pub save_plots: bool,
    #[serde(default = "default_true")]
    pub save_squiglink: bool,
    #[serde(default)]
    pub mono_mode: bool,
    #[serde(default)]
    pub mono_side: Option<SweepMonoSide>,
    /// When running guided mono sweep (L then R), pass the same tag to both
    /// calls so they share one output folder instead of creating separate ones.
    #[serde(default)]
    pub shared_run_tag: Option<String>,
}

impl Default for SweepFrRequest {
    fn default() -> Self {
        Self {
            f0: 20.0,
            f1: 20_000.0,
            duration_secs: 6.0,
            repeats: 1,
            amplitude: 0.5,
            output_dir: None,
            save_plots: true,
            save_squiglink: true,
            mono_mode: false,
            mono_side: None,
            shared_run_tag: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SweepMonoSide {
    Left,
    Right,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThdRequest {
    pub tones: Vec<f32>,
    pub tone_duration_secs: f32,
    pub amplitude: f32,
}

impl Default for ThdRequest {
    fn default() -> Self {
        Self {
            tones: vec![100.0, 1000.0, 6000.0],
            tone_duration_secs: 1.0,
            amplitude: 0.6,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceRequest {
    pub frequency_hz: f32,
    pub tone_duration_secs: f32,
    pub settle_secs: f32,
}

impl Default for BalanceRequest {
    fn default() -> Self {
        Self {
            frequency_hz: 1000.0,
            tone_duration_secs: 1.0,
            settle_secs: 0.2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrosstalkRequest {
    pub frequency_hz: f32,
    pub tone_duration_secs: f32,
    pub settle_secs: f32,
    pub direction: String,
}

impl Default for CrosstalkRequest {
    fn default() -> Self {
        Self {
            frequency_hz: 1000.0,
            tone_duration_secs: 1.0,
            settle_secs: 0.2,
            direction: "LtoR".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AncSnapshotRequest {
    pub f0: f32,
    pub f1: f32,
    pub duration_secs: f32,
    pub repeats: u32,
    pub amplitude: f32,
    /// Which side to drive/record for this snapshot. `Both` (default) keeps the
    /// original stereo behaviour; `Left`/`Right` drive a single channel so a
    /// single mic can be moved between ears (guided "advanced mono mode").
    #[serde(default)]
    pub capture_side: AncCaptureSide,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AncCaptureSide {
    #[default]
    Both,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AncSnapshot {
    pub freqs: Vec<f32>,
    pub mag_db_left: Vec<f32>,
    pub mag_db_right: Vec<f32>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyProgressEvent {
    pub current: u32,
    pub total: u32,
    pub delay_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProgressEvent {
    pub test: String,
    pub current: u32,
    pub total: u32,
    pub value: Option<f32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputLevelEvent {
    pub current_dbfs: f32,
    pub peak_dbfs: f32,
    pub clip_count: u32,
    pub rough_fr_hz: Vec<f32>,
    pub rough_fr_db: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyMeasurement {
    pub iteration: u32,
    pub delay_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyTestReport {
    pub signal: TestSignalKind,
    pub sample_rate: u32,
    pub input_sample_rate: u32,
    pub measurements: Vec<LatencyMeasurement>,
    pub average_delay_ms: Option<f32>,
    pub std_dev_ms: Option<f32>,
    pub cancelled: bool,
    pub timestamp_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyExportEntry {
    pub request: LatencyTestRequest,
    pub report: LatencyTestReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResultPayload {
    pub test: String,
    pub timestamp: String,
    pub params: Value,
    pub metrics: Value,
    pub data: Value,
    pub files: Value,
}

#[derive(Debug, Error)]
pub enum AudioError {
    // Constructed only on Windows (see `preferred_host`); dead on other targets.
    #[allow(dead_code)]
    #[error("audio host error: {0}")]
    HostUnavailable(String),
    #[error("audio devices enumeration failed: {0}")]
    DevicesUnavailable(#[from] cpal::DevicesError),
    #[error("audio device name unavailable: {0}")]
    DeviceName(#[from] cpal::DeviceNameError),
    #[error("default stream config unavailable: {0}")]
    DefaultConfig(#[from] cpal::DefaultStreamConfigError),
    #[error("supported stream config query failed: {0}")]
    SupportedConfig(#[from] cpal::SupportedStreamConfigsError),
    #[error("failed to build audio stream: {0}")]
    BuildStream(#[from] cpal::BuildStreamError),
    #[error("failed to start audio stream: {0}")]
    PlayStream(#[from] cpal::PlayStreamError),
    #[error("no compatible input device found")]
    MissingInputDevice,
    #[error("no compatible output device found")]
    MissingOutputDevice,
    #[error("unsupported sample format: {0}")]
    UnsupportedSampleFormat(String),
    #[error("file export failed: {0}")]
    FileExport(String),
    #[error("measurement cancelled")]
    Cancelled,
    #[error("recording failed: {0}")]
    RecordingError(String),
}

pub struct AudioEngine {
    settings: AudioSettings,
}

#[derive(Clone, Copy)]
enum OutputRouting {
    Both,
    LeftOnly,
    RightOnly,
}

struct AudioRuntime {
    output_device: Device,
    input_device: Device,
    output_config: StreamConfig,
    output_format: SampleFormat,
    input_config: StreamConfig,
    input_format: SampleFormat,
    output_rate: u32,
    input_rate: u32,
    /// Copied from settings so every capture helper can reach it without
    /// threading the whole settings struct through.
    bluetooth_mode: bool,
    /// Stop request. Checked while a capture is recording, so Stop ends the
    /// capture in flight instead of waiting for it to finish.
    cancel: Arc<AtomicBool>,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            settings: AudioSettings::default(),
        }
    }

    pub fn settings(&self) -> AudioSettings {
        self.settings.clone()
    }

    pub fn set_settings(&mut self, mut settings: AudioSettings) {
        settings.output_sample_rate = settings.output_sample_rate.clamp(8_000, 192_000);
        settings.input_sample_rate = settings.input_sample_rate.clamp(8_000, 192_000);
        settings.duration_secs = settings.duration_secs.clamp(0.03, 12.0);
        settings.chunk_size = settings.chunk_size.clamp(64, 8192);
        settings.item_name = settings.item_name.trim().to_string();
        self.settings = settings;
    }

    pub fn list_devices(&self) -> Result<DeviceInventory, AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let input_entries = enumerate_input_devices(&host)?;
        let output_infos: Vec<AudioDeviceInfo> = output_entries
            .iter()
            .map(|(_, info)| info.clone())
            .collect();
        let input_infos: Vec<AudioDeviceInfo> =
            input_entries.iter().map(|(_, info)| info.clone()).collect();
        let default_output = default_index_for_output(&host, &output_infos);
        let default_input = default_index_for_input(&host, &input_infos);

        Ok(DeviceInventory {
            inputs: input_infos,
            outputs: output_infos,
            default_input_index: default_input,
            default_output_index: default_output,
        })
    }

    /// Round-trip latency.
    ///
    /// This test deliberately ignores `bluetooth_mode`. Every other test treats
    /// link delay as an obstacle and removes it; here the delay is the
    /// measurement. Wrapping the signal in timing markers, widening the
    /// silences, or picking an analysis window by energy would all change the
    /// number this test exists to report, so the wireless path stays out of it
    /// and the raw signal is timed exactly as it was before.
    pub fn run_latency_test(
        settings: AudioSettings,
        request: LatencyTestRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<LatencyTestReport, AudioError> {
        let item_name = settings.item_name.clone();
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let repeats = request.repeats.clamp(1, 128);
        let duration = request.duration_secs.clamp(0.03, 12.0);
        let amplitude = request.amplitude.clamp(0.01, 1.0);
        let margin = request.record_margin_secs.clamp(0.1, 6.0);
        let (preset_key, preset_name) =
            latency_preset_identity(request.signal, request.frequency_hz);

        let mut measurements = Vec::with_capacity(repeats as usize);
        let mut first_recorded: Option<Vec<f32>> = None;
        let mut first_reference: Option<Vec<f32>> = None;
        for iteration in 1..=repeats {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let signal = generate_latency_chirp(
                request.frequency_hz.max(20.0),
                duration,
                amplitude,
                runtime.output_rate,
                runtime.max_excitation_hz(),
            );
            // A Stop mid-capture keeps the iterations already measured.
            let recorded = match runtime.play_and_record_mono(
                signal.clone(),
                OutputRouting::Both,
                duration + margin,
            ) {
                Ok(recorded) => recorded,
                Err(AudioError::Cancelled) => break,
                Err(error) => return Err(error),
            };
            let reference = if runtime.input_rate != runtime.output_rate {
                resample_cubic(&signal, runtime.output_rate, runtime.input_rate)
            } else {
                signal
            };
            let delay = find_delay_ms(&recorded, &reference, runtime.input_rate);
            if first_recorded.is_none() && delay.is_some() {
                first_recorded = Some(recorded.clone());
                first_reference = Some(reference.clone());
            }
            measurements.push(LatencyMeasurement {
                iteration,
                delay_ms: delay,
            });
            let _ = app.emit(
                "latency-progress",
                LatencyProgressEvent {
                    current: iteration,
                    total: repeats,
                    delay_ms: delay,
                },
            );
            let _ = app.emit(
                "test-progress",
                TestProgressEvent {
                    test: "latency".to_string(),
                    current: iteration,
                    total: repeats,
                    value: delay,
                    message: format!("iteration {iteration}/{repeats}"),
                },
            );
        }

        if measurements.is_empty() {
            return Err(AudioError::Cancelled);
        }

        let valid: Vec<f32> = measurements
            .iter()
            .filter_map(|item| item.delay_ms)
            .collect();
        let average_delay = if valid.is_empty() {
            None
        } else {
            Some(mean(&valid))
        };
        let std_dev = average_delay.map(|avg| standard_deviation(&valid, avg));
        let cancelled = cancel.load(Ordering::SeqCst) && measurements.len() < repeats as usize;

        let report = LatencyTestReport {
            signal: request.signal,
            sample_rate: runtime.output_rate,
            input_sample_rate: runtime.input_rate,
            measurements,
            average_delay_ms: average_delay,
            std_dev_ms: std_dev,
            cancelled,
            timestamp_utc: timestamp_string(),
        };

        let output_dir = latency_output_dir(&request, &item_name);
        if request.save_per_sound_plot {
            if let (Some(rec), Some(reference), Some(avg_delay)) = (
                first_recorded.as_ref(),
                first_reference.as_ref(),
                report.average_delay_ms,
            ) {
                if let Ok(path) = latency_plot_path(&output_dir, &preset_key) {
                    if save_latency_plot(
                        &path,
                        rec,
                        reference,
                        avg_delay,
                        request.calibrated_offset_ms,
                        runtime.input_rate,
                        &preset_name,
                        valid.len(),
                    )
                    .is_ok()
                    {
                        let _ = app.emit(
                            "test-progress",
                            TestProgressEvent {
                                test: "latency".to_string(),
                                current: repeats,
                                total: repeats,
                                value: report.average_delay_ms,
                                message: format!("saved plot -> {}", path.display()),
                            },
                        );
                    }
                }
            }
        }

        if request.save_overall_bar_chart && !valid.is_empty() {
            if let Ok(path) = overall_bar_path(&output_dir) {
                // The report returned here is raw; the UI subtracts the offset.
                // Chart the same calibrated numbers the report text will show.
                let calibrated: Vec<f32> = valid
                    .iter()
                    .map(|delay| delay - request.calibrated_offset_ms)
                    .collect();
                let bars = vec![(preset_name.clone(), calibrated)];
                if save_overall_bar_chart(&path, &bars).is_ok() {
                    let _ = app.emit(
                        "test-progress",
                        TestProgressEvent {
                            test: "latency".to_string(),
                            current: repeats,
                            total: repeats,
                            value: report.average_delay_ms,
                            message: format!("saved bar chart -> {}", path.display()),
                        },
                    );
                }
            }
        }

        Ok(report)
    }

    pub fn export_latency_report(
        request: &LatencyTestRequest,
        report: &LatencyTestReport,
        item_name: &str,
    ) -> Result<PathBuf, AudioError> {
        let output_dir = latency_output_dir(request, item_name);
        ensure_output_dir(&output_dir)?;
        let path = output_dir.join(format!("latency_report_{}.txt", timestamp_filename()));
        let text = build_latency_text_report(request, report);
        write_text_file(&path, &text)?;
        Ok(path)
    }

    pub fn export_latency_suite_report(
        request: &LatencyTestRequest,
        suite: &[LatencyExportEntry],
        item_name: &str,
    ) -> Result<PathBuf, AudioError> {
        let output_dir = latency_output_dir(request, item_name);
        ensure_output_dir(&output_dir)?;
        let path = output_dir.join(format!("latency_report_{}.txt", timestamp_filename()));
        let text = build_latency_suite_text_report(suite);
        write_text_file(&path, &text)?;
        Ok(path)
    }

    pub fn save_latency_overall_bar_chart(
        request: &LatencyTestRequest,
        suite: &[LatencyExportEntry],
        item_name: &str,
    ) -> Result<PathBuf, AudioError> {
        let output_dir = latency_output_dir(request, item_name);
        ensure_output_dir(&output_dir)?;
        let path = output_dir.join(format!("overall_bar_{}.png", timestamp_filename()));
        let bars = latency_bars_from_suite(suite);
        if bars.is_empty() {
            return Err(AudioError::FileExport(
                "no valid latency values available for bar chart".to_string(),
            ));
        }
        save_overall_bar_chart(&path, &bars)?;
        Ok(path)
    }

    pub fn run_input_monitor(
        settings: AudioSettings,
        cancel: Arc<AtomicBool>,
        peak_reset: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<(), AudioError> {
        let host = preferred_host()?;
        let input_entries = enumerate_input_devices(&host)?;
        let input_device = select_device(
            &host,
            &input_entries,
            settings.input_device_index,
            settings.input_device_name.as_deref(),
            true,
        )?;
        let (input_config, input_format) =
            choose_input_config(&input_device, settings.input_sample_rate)?;
        let channels = input_config.channels as usize;

        let stats = Arc::new(Mutex::new(MonitorStats {
            current_dbfs: -96.0,
            peak_dbfs: -96.0,
            clip_count: 0,
            sample_rate: input_config.sample_rate.0,
            recent_mono: Vec::new(),
            rough_fr_hz: logspace(
                20.0,
                (input_config.sample_rate.0 as f32 * 0.45).min(20_000.0),
                48,
            ),
            rough_fr_db: vec![0.0; 48],
        }));

        let err_fn = |err| {
            eprintln!("input monitor stream error: {err}");
        };

        let stream = build_monitor_stream(
            &input_device,
            &input_config,
            input_format,
            channels,
            stats.clone(),
            err_fn,
        )?;
        stream.play()?;

        while !cancel.load(Ordering::SeqCst) {
            if peak_reset.swap(false, Ordering::SeqCst) {
                if let Ok(mut state) = stats.lock() {
                    state.peak_dbfs = state.current_dbfs;
                    state.clip_count = 0;
                }
            }

            // Copy what the FFT needs and release the lock before computing:
            // the input callback takes the same lock, and holding it through
            // an 8k-point FFT can stall the audio thread.
            let snapshot = stats.lock().ok().map(|state| {
                (
                    state.recent_mono.clone(),
                    state.sample_rate,
                    state.rough_fr_hz.clone(),
                )
            });
            let next_rough = snapshot
                .map(|(samples, rate, grid)| compute_monitor_rough_fr_db(&samples, rate, &grid))
                .unwrap_or_default();
            if let Ok(mut state) = stats.lock() {
                if !next_rough.is_empty() && state.rough_fr_db.len() == next_rough.len() {
                    for (prev, next) in state.rough_fr_db.iter_mut().zip(next_rough.iter()) {
                        *prev = *prev * 0.55 + *next * 0.45;
                    }
                }
                let _ = app.emit(
                    "input-level",
                    InputLevelEvent {
                        current_dbfs: state.current_dbfs,
                        peak_dbfs: state.peak_dbfs,
                        clip_count: state.clip_count,
                        rough_fr_hz: state.rough_fr_hz.clone(),
                        rough_fr_db: state.rough_fr_db.clone(),
                    },
                );
            }

            std::thread::sleep(Duration::from_millis(60));
        }

        stream.pause().ok();
        drop(stream);
        Ok(())
    }

    pub fn run_pink_noise(
        settings: AudioSettings,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let output_device = select_device(
            &host,
            &output_entries,
            settings.output_device_index,
            settings.output_device_name.as_deref(),
            false,
        )?;
        let (output_config, output_format) =
            choose_output_config(&output_device, settings.output_sample_rate)?;
        let channels = output_config.channels as usize;

        let noise_state = Arc::new(Mutex::new(PinkNoiseState::new(0.25)));
        let err_fn = |err| {
            eprintln!("pink noise stream error: {err}");
        };

        let stream = build_pink_output_stream(
            &output_device,
            &output_config,
            output_format,
            OutputRouting::Both,
            channels,
            noise_state,
            err_fn,
        )?;
        stream.play()?;

        while !cancel.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(50));
        }

        stream.pause().ok();
        drop(stream);
        Ok(())
    }

    pub fn run_sweep_fr_test(
        settings: AudioSettings,
        mut request: SweepFrRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<TestResultPayload, AudioError> {
        let item_name = settings.item_name.clone();
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let (f0, f1) = clamp_sweep_band(request.f0, request.f1, runtime.max_excitation_hz());
        request.f0 = f0;
        request.f1 = f1;
        request.duration_secs = request.duration_secs.clamp(0.5, 20.0);
        request.amplitude = request.amplitude.clamp(0.05, 1.0);
        request.repeats = request.repeats.clamp(1, 16);
        let mono_side = request.mono_side.unwrap_or(SweepMonoSide::Both);

        let grid = logspace(request.f0, request.f1, 200);
        let mut mags_l: Vec<Vec<f32>> = Vec::new();
        let mut mags_r: Vec<Vec<f32>> = Vec::new();
        let mut delays_l: Vec<Option<f32>> = Vec::new();
        let mut delays_r: Vec<Option<f32>> = Vec::new();
        let mut last_diagnostics: Option<AlignmentDiagnostics> = None;
        // Set when a stereo capture had to reuse one channel for both sides.
        let mut mirrored_side: Option<&'static str> = None;

        for i in 1..=request.repeats {
            if cancel.load(Ordering::SeqCst) {
                // A partial set of repeats is not the measurement asked for.
                return Err(AudioError::Cancelled);
            }

            let chirp = generate_log_chirp(
                request.f0,
                request.f1,
                request.duration_secs,
                request.amplitude,
                runtime.output_rate,
            );
            let ref_signal = if runtime.input_rate != runtime.output_rate {
                resample_cubic(&chirp, runtime.output_rate, runtime.input_rate)
            } else {
                chirp.clone()
            };

            // Wireless captures take the marker-locked path, which measures the
            // clock drift over the sweep and undoes it. Wired captures keep the
            // original single-delay alignment, unchanged.
            let (aligned_l, aligned_r, delay_l, delay_r) = if runtime.bluetooth_mode {
                capture_marked_sweep(
                    &runtime,
                    &chirp,
                    &ref_signal,
                    request.mono_mode,
                    mono_side,
                    &mut last_diagnostics,
                    &mut mirrored_side,
                )?
            } else {
                let (rec_l, rec_r) = if request.mono_mode {
                    let left = if mono_side != SweepMonoSide::Right {
                        let captured_l = runtime.play_and_record_channels(
                            chirp.clone(),
                            OutputRouting::LeftOnly,
                            request.duration_secs + 0.5,
                        )?;
                        channel_or_mix(&captured_l, 0)
                    } else {
                        Vec::new()
                    };

                    let right = if mono_side != SweepMonoSide::Left {
                        let captured_r = runtime.play_and_record_channels(
                            chirp.clone(),
                            OutputRouting::RightOnly,
                            request.duration_secs + 0.5,
                        )?;
                        if captured_r.len() > 1 {
                            channel_or_mix(&captured_r, 1)
                        } else {
                            channel_or_mix(&captured_r, 0)
                        }
                    } else {
                        Vec::new()
                    };
                    (left, right)
                } else {
                    let captured = runtime.play_and_record_channels(
                        chirp.clone(),
                        OutputRouting::Both,
                        request.duration_secs + 0.5,
                    )?;
                    mirrored_side = mirrored_side.or(mirrored_channel(&captured));
                    let left = channel_or_mix(&captured, 0);
                    let right = if captured.len() > 1 {
                        channel_or_mix(&captured, 1)
                    } else {
                        left.clone()
                    };
                    (left, right)
                };

                let delay_l = if rec_l.is_empty() {
                    None
                } else {
                    find_delay_ms(&rec_l, &ref_signal, runtime.input_rate)
                };
                let delay_r = if rec_r.is_empty() {
                    None
                } else {
                    find_delay_ms(&rec_r, &ref_signal, runtime.input_rate)
                };

                let aligned_l = if rec_l.is_empty() {
                    Vec::new()
                } else {
                    align_to_reference(&rec_l, ref_signal.len(), delay_l, runtime.input_rate)
                };
                let aligned_r = if rec_r.is_empty() {
                    Vec::new()
                } else {
                    align_to_reference(&rec_r, ref_signal.len(), delay_r, runtime.input_rate)
                };
                (aligned_l, aligned_r, delay_l, delay_r)
            };

            delays_l.push(delay_l);
            delays_r.push(delay_r);

            let mag_db_l = if aligned_l.is_empty() {
                Vec::new()
            } else {
                frequency_response_curve(&aligned_l, &ref_signal, runtime.input_rate, &grid)
            };
            let mag_db_r = if aligned_r.is_empty() {
                Vec::new()
            } else {
                frequency_response_curve(&aligned_r, &ref_signal, runtime.input_rate, &grid)
            };
            mags_l.push(mag_db_l);
            mags_r.push(mag_db_r);

            let progress_value = if request.mono_mode {
                match mono_side {
                    SweepMonoSide::Left => delay_l,
                    SweepMonoSide::Right => delay_r,
                    SweepMonoSide::Both => delay_l.or(delay_r),
                }
            } else {
                delay_l
            };

            let _ = app.emit(
                "test-progress",
                TestProgressEvent {
                    test: "sweep_fr".to_string(),
                    current: i,
                    total: request.repeats,
                    value: progress_value,
                    message: if request.mono_mode {
                        let side_label = match mono_side {
                            SweepMonoSide::Left => "left",
                            SweepMonoSide::Right => "right",
                            SweepMonoSide::Both => "left+right",
                        };
                        format!("mono ({side_label}) sweep {i}/{}", request.repeats)
                    } else {
                        match mirrored_side {
                            Some(side) => format!(
                                "sweep {i}/{} — {side} channel silent, mirrored from the other side",
                                request.repeats
                            ),
                            None => format!("sweep {i}/{}", request.repeats),
                        }
                    },
                },
            );
        }

        if mags_l.is_empty() {
            return Err(AudioError::Cancelled);
        }

        let left_avg = average_curves(&mags_l);
        let right_avg = average_curves(&mags_r);
        let mut all_curves = Vec::new();
        all_curves.extend(mags_l.iter().filter(|curve| !curve.is_empty()).cloned());
        all_curves.extend(mags_r.iter().filter(|curve| !curve.is_empty()).cloned());
        let avg_all = average_curves(&all_curves);
        let avg_delay_l = average_option(&delays_l);
        let avg_delay_r = average_option(&delays_r);
        let has_left_data = mags_l.iter().any(|curve| !curve.is_empty());
        let has_right_data = mags_r.iter().any(|curve| !curve.is_empty());

        if request.mono_mode {
            let expected_left = mono_side != SweepMonoSide::Right;
            let expected_right = mono_side != SweepMonoSide::Left;
            if expected_left && !has_left_data {
                return Err(AudioError::RecordingError(
                    "Mono left sweep captured no audio. Check device and connections.".into(),
                ));
            }
            if expected_right && !has_right_data {
                return Err(AudioError::RecordingError(
                    "Mono right sweep captured no audio. Check device and connections.".into(),
                ));
            }
        }

        let run_tag = request
            .shared_run_tag
            .clone()
            .unwrap_or_else(timestamp_filename);
        let files = write_sweep_outputs(
            &resolve_measurement_output_dir(&request.output_dir, &item_name, &run_tag),
            &run_tag,
            request.save_plots,
            request.save_squiglink,
            &grid,
            &mags_l,
            &mags_r,
        )?;

        Ok(TestResultPayload {
            test: "sweep_fr".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "f0": request.f0,
                "f1": request.f1,
                "duration": request.duration_secs,
                "repeats": request.repeats,
                "mono_mode": request.mono_mode,
                "mono_side": request.mono_side,
                "save_plots": request.save_plots,
                "save_squiglink": request.save_squiglink,
                "output_dir": request.output_dir.clone(),
                "bluetooth_mode": runtime.bluetooth_mode
            }),
            metrics: json!({
                "delay_ms_left": avg_delay_l,
                "delay_ms_right": avg_delay_r,
                "alignment": last_diagnostics,
                "mirrored_channel": mirrored_side
            }),
            data: json!({
                "freqs": grid,
                "left_mag_db_avg": left_avg,
                "left_mag_db_all": mags_l,
                "right_mag_db_avg": right_avg,
                "right_mag_db_all": mags_r,
                "mag_db_all": all_curves,
                "mag_db_avg_all": avg_all
            }),
            files: Value::Object(files),
        })
    }

    pub fn run_thd_test(
        settings: AudioSettings,
        request: ThdRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let tones = if request.tones.is_empty() {
            vec![100.0, 1000.0, 6000.0]
        } else {
            request.tones.clone()
        };
        let tone_duration = request.tone_duration_secs.clamp(0.1, 6.0);
        let amp = request.amplitude.clamp(0.05, 1.0);
        let max_hz = runtime.max_excitation_hz();
        if let Some(bad) = tones
            .iter()
            .find(|freq| !freq.is_finite() || **freq < 20.0 || **freq > max_hz)
        {
            return Err(AudioError::RecordingError(format!(
                "THD tone {bad} Hz is outside what this device pair can carry (20 to {max_hz:.0} Hz)."
            )));
        }

        let mut items = Vec::new();
        for (idx, freq) in tones.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let signal = generate_sine(*freq, tone_duration, amp, runtime.output_rate);
            // A Stop mid-tone keeps the tones already measured.
            let recorded = match runtime.play_and_record_mono(
                signal,
                OutputRouting::Both,
                runtime.tone_record_secs(tone_duration),
            ) {
                Ok(recorded) => recorded,
                Err(AudioError::Cancelled) => break,
                Err(error) => return Err(error),
            };
            let recorded = runtime.steady_window(recorded, tone_duration);
            let thd = compute_thd(&recorded, *freq, runtime.input_rate, 10);
            items.push(json!({"freq": *freq, "thd_percent": thd}));
            let _ = app.emit(
                "test-progress",
                TestProgressEvent {
                    test: "thd".to_string(),
                    current: (idx + 1) as u32,
                    total: tones.len() as u32,
                    value: Some(thd),
                    message: format!("{freq:.0} Hz -> {thd:.3}%"),
                },
            );
        }

        if items.is_empty() {
            return Err(AudioError::Cancelled);
        }

        Ok(TestResultPayload {
            test: "thd".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "tones": tones,
                "tone_dur": tone_duration
            }),
            metrics: json!({
                "items": items
            }),
            data: json!({}),
            files: json!({}),
        })
    }

    pub fn run_balance_test(
        settings: AudioSettings,
        request: BalanceRequest,
        cancel: Arc<AtomicBool>,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let freq = request
            .frequency_hz
            .clamp(20.0, runtime.max_excitation_hz().max(20.0));
        let duration = request.tone_duration_secs.clamp(0.1, 6.0);
        let settle = request.settle_secs.clamp(0.0, 2.0);

        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let signal = generate_sine(freq, duration, 0.8, runtime.output_rate);
        let rec_l = runtime.play_and_record_mono(
            signal.clone(),
            OutputRouting::LeftOnly,
            runtime.tone_record_secs(duration),
        )?;
        let rec_l = runtime.steady_window(rec_l, duration);
        std::thread::sleep(Duration::from_secs_f32(settle + runtime.settle_secs()));
        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let rec_r = runtime.play_and_record_mono(
            signal,
            OutputRouting::RightOnly,
            runtime.tone_record_secs(duration),
        )?;
        let rec_r = runtime.steady_window(rec_r, duration);

        let level_l = dbfs(&rec_l);
        let level_r = dbfs(&rec_r);
        let diff = level_l - level_r;

        Ok(TestResultPayload {
            test: "balance".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "freq": freq,
                "duration": duration
            }),
            metrics: json!({
                "left_dBFS": level_l,
                "right_dBFS": level_r,
                "L_minus_R_dB": diff
            }),
            data: json!({}),
            files: json!({}),
        })
    }

    pub fn run_crosstalk_test(
        settings: AudioSettings,
        request: CrosstalkRequest,
        cancel: Arc<AtomicBool>,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let freq = request
            .frequency_hz
            .clamp(20.0, runtime.max_excitation_hz().max(20.0));
        let duration = request.tone_duration_secs.clamp(0.1, 6.0);
        let settle = request.settle_secs.clamp(0.0, 2.0);
        let direction = if request.direction.eq_ignore_ascii_case("rtol") {
            "RtoL"
        } else {
            "LtoR"
        };

        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let signal = generate_sine(freq, duration, 0.8, runtime.output_rate);
        let routing = if direction == "RtoL" {
            OutputRouting::RightOnly
        } else {
            OutputRouting::LeftOnly
        };
        let captured = runtime.play_and_record_channels(
            signal.clone(),
            routing,
            runtime.tone_record_secs(duration),
        )?;
        let (rec_primary, rec_leak) = if captured.len() > 1 {
            // Raw channels, never channel_or_mix: the leak channel is supposed
            // to be near-silent, and a dead-channel fallback would hand it the
            // driven signal and report ~0 dB crosstalk for perfect isolation.
            if direction == "RtoL" {
                (channel_raw(&captured, 1), channel_raw(&captured, 0))
            } else {
                (channel_raw(&captured, 0), channel_raw(&captured, 1))
            }
        } else {
            std::thread::sleep(Duration::from_secs_f32(settle + runtime.settle_secs()));
            if cancel.load(Ordering::SeqCst) {
                return Err(AudioError::Cancelled);
            }
            let leak_routing = if direction == "RtoL" {
                OutputRouting::LeftOnly
            } else {
                OutputRouting::RightOnly
            };
            let primary = mixdown_channels(&captured);
            let leak = runtime.play_and_record_mono(
                signal,
                leak_routing,
                runtime.tone_record_secs(duration),
            )?;
            (primary, leak)
        };

        let (rec_primary, rec_leak) = runtime.steady_window_pair(rec_primary, rec_leak, duration);
        let primary_rms = rms(&rec_primary);
        let leak_rms = rms(&rec_leak);
        let crosstalk_db = 20.0 * (leak_rms.max(1e-12) / primary_rms.max(1e-12)).log10();

        Ok(TestResultPayload {
            test: "crosstalk".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "freq": freq,
                "duration": duration,
                "direction": direction
            }),
            metrics: json!({
                "primary_rms": primary_rms,
                "leak_rms": leak_rms,
                "crosstalk_dB": crosstalk_db
            }),
            data: json!({}),
            files: json!({}),
        })
    }

    pub fn capture_anc_snapshot(
        settings: AudioSettings,
        request: AncSnapshotRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<AncSnapshot, AudioError> {
        let runtime = AudioRuntime::new(settings, cancel.clone())?;
        let (f0, f1) = clamp_sweep_band(request.f0, request.f1, runtime.max_excitation_hz());
        let duration = request.duration_secs.clamp(0.5, 20.0);
        let amplitude = request.amplitude.clamp(0.05, 1.0);
        let repeats = request.repeats.clamp(1, 8);
        let grid = logspace(f0, f1, 200);
        let mut mags_l: Vec<Vec<f32>> = Vec::new();
        let mut mags_r: Vec<Vec<f32>> = Vec::new();

        for i in 1..=repeats {
            if cancel.load(Ordering::SeqCst) {
                // Averaging fewer repeats than asked would pass off a partial
                // capture as a finished one, and the guided flow would advance.
                return Err(AudioError::Cancelled);
            }
            let chirp = generate_log_chirp(f0, f1, duration, amplitude, runtime.output_rate);
            let ref_signal = if runtime.input_rate != runtime.output_rate {
                resample_cubic(&chirp, runtime.output_rate, runtime.input_rate)
            } else {
                chirp.clone()
            };
            let routing = match request.capture_side {
                AncCaptureSide::Both => OutputRouting::Both,
                AncCaptureSide::Left => OutputRouting::LeftOnly,
                AncCaptureSide::Right => OutputRouting::RightOnly,
            };
            // Wireless captures are played inside a marker layout so the sweep
            // window can be drift-corrected; wired captures keep the original
            // single-delay alignment.
            let (captured, marked_layout) = if runtime.bluetooth_mode {
                let (channels, layout) =
                    runtime.play_and_record_marked(chirp, &ref_signal, routing)?;
                (channels, Some(layout))
            } else {
                (
                    runtime.play_and_record_channels(chirp, routing, duration + 0.5)?,
                    None,
                )
            };
            // Aligned magnitude curve for one recorded channel.
            let curve = |rec: &[f32]| -> Result<Vec<f32>, AudioError> {
                let aligned = match marked_layout.as_ref() {
                    Some(layout) => runtime.align_channel(layout, rec)?.samples,
                    None => {
                        let delay = find_delay_ms(rec, &ref_signal, runtime.input_rate);
                        align_to_reference(rec, ref_signal.len(), delay, runtime.input_rate)
                    }
                };
                Ok(frequency_response_curve(
                    &aligned,
                    &ref_signal,
                    runtime.input_rate,
                    &grid,
                ))
            };
            // A both-sides capture on a single-mic rig legitimately mirrors one
            // channel onto the other, but a genuinely broken mic looks
            // identical, so say so rather than shipping two identical curves as
            // if both sides were measured.
            let mut mirrored_side: Option<&str> = None;
            match request.capture_side {
                AncCaptureSide::Both => {
                    mirrored_side = mirrored_channel(&captured);
                    let rec_l = channel_or_mix(&captured, 0);
                    let rec_r = if captured.len() > 1 {
                        channel_or_mix(&captured, 1)
                    } else {
                        rec_l.clone()
                    };
                    mags_l.push(curve(&rec_l)?);
                    mags_r.push(curve(&rec_r)?);
                }
                AncCaptureSide::Left => {
                    mags_l.push(curve(&channel_or_mix(&captured, 0))?);
                }
                AncCaptureSide::Right => {
                    let rec_r = if captured.len() > 1 {
                        channel_or_mix(&captured, 1)
                    } else {
                        channel_or_mix(&captured, 0)
                    };
                    mags_r.push(curve(&rec_r)?);
                }
            }
            let mirror_note = match mirrored_side {
                Some(side) => format!(" — {side} channel silent, mirrored"),
                None => String::new(),
            };
            let message = format!("Sweep {i}/{repeats} done{mirror_note}");
            app.emit(
                "test-progress",
                TestProgressEvent {
                    test: "anc_snapshot".to_string(),
                    current: i,
                    total: repeats,
                    value: None,
                    message,
                },
            )
            .ok();
        }

        Ok(AncSnapshot {
            freqs: grid,
            mag_db_left: average_curves(&mags_l),
            mag_db_right: average_curves(&mags_r),
            timestamp: timestamp_string(),
        })
    }
}

/// One channel's aligned excitation window plus how the alignment went.
struct CapturedExcitation {
    samples: Vec<f32>,
    diagnostics: Option<AlignmentDiagnostics>,
}

impl AudioRuntime {
    fn new(settings: AudioSettings, cancel: Arc<AtomicBool>) -> Result<Self, AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let input_entries = enumerate_input_devices(&host)?;
        let output_device = select_device(
            &host,
            &output_entries,
            settings.output_device_index,
            settings.output_device_name.as_deref(),
            false,
        )?;
        let input_device = select_device(
            &host,
            &input_entries,
            settings.input_device_index,
            settings.input_device_name.as_deref(),
            true,
        )?;
        let (output_config, output_format) =
            choose_output_config(&output_device, settings.output_sample_rate)?;
        let (input_config, input_format) =
            choose_input_config(&input_device, settings.input_sample_rate)?;

        Ok(Self {
            bluetooth_mode: settings.bluetooth_mode,
            cancel,
            output_rate: output_config.sample_rate.0,
            input_rate: input_config.sample_rate.0,
            output_device,
            input_device,
            output_config,
            output_format,
            input_config,
            input_format,
        })
    }

    fn play_and_record_mono(
        &self,
        signal: Vec<f32>,
        routing: OutputRouting,
        record_duration_secs: f32,
    ) -> Result<Vec<f32>, AudioError> {
        let channels = self.play_and_record_channels(signal, routing, record_duration_secs)?;
        Ok(mixdown_channels(&channels))
    }

    /// Highest excitation frequency both ends of the chain can carry. A
    /// 16 kHz hands-free Bluetooth link cannot play or capture a 20 kHz sweep;
    /// asking it to aliases the top of the sweep back into the band. At
    /// 44.1 kHz and above this stays at the usual 20 kHz ceiling.
    fn max_excitation_hz(&self) -> f32 {
        max_excitation_hz(self.output_rate, self.input_rate)
    }

    /// Timing padding for the current mode.
    fn measurement_profile(&self) -> MeasurementProfile {
        MeasurementProfile::for_mode(self.bluetooth_mode)
    }

    /// Extra settling the steady-state tone tests should allow before they
    /// trust the recorded level. Zero on a wired path.
    fn settle_secs(&self) -> f32 {
        self.measurement_profile().settle_secs
    }

    /// Recording time to add past the end of playback.
    fn record_margin_secs(&self) -> f32 {
        self.measurement_profile().record_margin_secs
    }

    /// How long to record for a steady-state tone of `tone_secs`.
    ///
    /// A wired path answers within milliseconds, so a fixed 0.3 s tail is
    /// plenty. A wireless path can take a third of a second just to deliver the
    /// first sample, which would truncate the tone before it finished.
    fn tone_record_secs(&self, tone_secs: f32) -> f32 {
        if self.bluetooth_mode {
            tone_secs + self.record_margin_secs()
        } else {
            tone_secs + 0.3
        }
    }

    /// Narrow a capture down to the part that actually holds the tone.
    ///
    /// On a wireless link the recording opens with link latency and closes
    /// with the codec tail, and averaging those in drags every level reading
    /// down. Picking the strongest window of the expected length sidesteps the
    /// problem without needing to know the delay. Wired captures are returned
    /// untouched, so their numbers do not move.
    fn steady_window(&self, recorded: Vec<f32>, tone_secs: f32) -> Vec<f32> {
        if !self.bluetooth_mode {
            return recorded;
        }
        strongest_window(&recorded, self.steady_window_len(tone_secs))
    }

    /// Same, for two channels that must share one window.
    ///
    /// Crosstalk divides one channel by the other, so both have to describe the
    /// same slice of time. The window is chosen from the driven channel, since
    /// the leak channel is meant to be near-silent and has no peak worth
    /// finding.
    fn steady_window_pair(
        &self,
        primary: Vec<f32>,
        leak: Vec<f32>,
        tone_secs: f32,
    ) -> (Vec<f32>, Vec<f32>) {
        if !self.bluetooth_mode {
            return (primary, leak);
        }
        let want = self.steady_window_len(tone_secs);
        let start = strongest_window_start(&primary, want);
        (
            window_at(&primary, start, want),
            window_at(&leak, start, want),
        )
    }

    fn steady_window_len(&self, tone_secs: f32) -> usize {
        (tone_secs * 0.7 * self.input_rate as f32).round() as usize
    }

    /// Play an excitation wrapped in timing markers and record it.
    ///
    /// Two layouts are built from the same profile: one at the output rate to
    /// play, and one at the input rate to search. They describe the same signal
    /// in time, which is what lets the markers be found in a recording captured
    /// at a different sample rate than it was played at.
    fn play_and_record_marked(
        &self,
        excitation_out: Vec<f32>,
        reference_in: &[f32],
        routing: OutputRouting,
    ) -> Result<(Vec<Vec<f32>>, alignment::MeasurementLayout), AudioError> {
        let profile = self.measurement_profile();
        let playback_layout = build_measurement_layout(self.output_rate, &excitation_out, profile);
        let analysis_layout = build_measurement_layout(self.input_rate, reference_in, profile);

        let record_secs = playback_layout.playback_duration_secs() + profile.record_margin_secs;
        let captured =
            self.play_and_record_channels(playback_layout.playback, routing, record_secs)?;
        Ok((captured, analysis_layout))
    }

    /// Lock one recorded channel onto the markers and return the corrected
    /// excitation window. An alignment that fails its confidence or drift
    /// budget becomes a recording error rather than a quietly wrong curve.
    fn align_channel(
        &self,
        layout: &alignment::MeasurementLayout,
        channel: &[f32],
    ) -> Result<CapturedExcitation, AudioError> {
        let settings = AlignmentSettings::for_mode(self.bluetooth_mode);
        match align_recording(channel, layout, settings, self.bluetooth_mode) {
            Ok(AlignedMeasurement {
                samples,
                diagnostics,
            }) => Ok(CapturedExcitation {
                samples,
                diagnostics: Some(diagnostics),
            }),
            Err(error) => {
                // A transient failure is worth saying so about: the user can
                // simply run the sweep again, whereas a short recording means
                // something about the setup has to change first.
                let advice = if error.failure.is_retryable() {
                    " Run the sweep again."
                } else {
                    ""
                };
                Err(AudioError::RecordingError(format!(
                    "{}{advice}",
                    error.message()
                )))
            }
        }
    }

    fn play_and_record_channels(
        &self,
        signal: Vec<f32>,
        routing: OutputRouting,
        record_duration_secs: f32,
    ) -> Result<Vec<Vec<f32>>, AudioError> {
        play_and_record(
            &self.output_device,
            &self.input_device,
            signal,
            routing,
            self.output_config.clone(),
            self.output_format,
            self.input_config.clone(),
            self.input_format,
            record_duration_secs,
            self.input_config.channels as usize,
            &self.cancel,
        )
    }
}

fn preferred_host() -> Result<Host, AudioError> {
    #[cfg(target_os = "windows")]
    {
        match cpal::host_from_id(cpal::HostId::Wasapi) {
            Ok(host) => Ok(host),
            Err(error) => Err(AudioError::HostUnavailable(error.to_string())),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(cpal::default_host())
    }
}

fn enumerate_output_devices(host: &Host) -> Result<Vec<(Device, AudioDeviceInfo)>, AudioError> {
    let mut output_devices = Vec::new();
    for (host_index, device) in host.devices()?.enumerate() {
        // Use supported_output_configs() as the capability gate.
        // default_output_config() fails for non-default devices on WASAPI/CoreAudio.
        let first_supported = device
            .supported_output_configs()
            .ok()
            .and_then(|mut iter| iter.next());
        let Some(first) = first_supported else {
            continue;
        };
        let (channels, default_sample_rate) = match device.default_output_config() {
            Ok(cfg) => (cfg.channels(), cfg.sample_rate().0),
            Err(_) => (first.channels(), first.max_sample_rate().0),
        };
        output_devices.push((
            device.clone(),
            AudioDeviceInfo {
                index: host_index,
                name: device.name()?,
                is_input: false,
                channels,
                default_sample_rate,
            },
        ));
    }
    Ok(output_devices)
}

fn enumerate_input_devices(host: &Host) -> Result<Vec<(Device, AudioDeviceInfo)>, AudioError> {
    let mut input_devices = Vec::new();
    for (host_index, device) in host.devices()?.enumerate() {
        // Use supported_input_configs() as the capability gate.
        // default_input_config() may fail for non-default devices on WASAPI/CoreAudio.
        let first_supported = device
            .supported_input_configs()
            .ok()
            .and_then(|mut iter| iter.next());
        let Some(first) = first_supported else {
            continue;
        };
        let (channels, default_sample_rate) = match device.default_input_config() {
            Ok(cfg) => (cfg.channels(), cfg.sample_rate().0),
            Err(_) => (first.channels(), first.max_sample_rate().0),
        };
        input_devices.push((
            device.clone(),
            AudioDeviceInfo {
                index: host_index,
                name: device.name()?,
                is_input: true,
                channels,
                default_sample_rate,
            },
        ));
    }
    Ok(input_devices)
}

fn default_index_for_output(host: &Host, outputs: &[AudioDeviceInfo]) -> Option<usize> {
    let name = host.default_output_device()?.name().ok()?;
    outputs
        .iter()
        .find(|item| item.name == name)
        .map(|item| item.index)
}

fn default_index_for_input(host: &Host, inputs: &[AudioDeviceInfo]) -> Option<usize> {
    let name = host.default_input_device()?.name().ok()?;
    inputs
        .iter()
        .find(|item| item.name == name)
        .map(|item| item.index)
}

fn select_device(
    host: &Host,
    entries: &[(Device, AudioDeviceInfo)],
    selected_index: Option<usize>,
    selected_name: Option<&str>,
    is_input: bool,
) -> Result<Device, AudioError> {
    if let Some(index) = resolve_selected_index(
        &entries
            .iter()
            .map(|(_, info)| info.clone())
            .collect::<Vec<_>>(),
        selected_index,
        selected_name,
    ) {
        if let Some((device, _)) = entries.iter().find(|(_, info)| info.index == index) {
            return Ok(device.clone());
        }
    }
    if is_input {
        if let Some(default_device) = host.default_input_device() {
            return Ok(default_device);
        }
    } else if let Some(default_device) = host.default_output_device() {
        return Ok(default_device);
    }
    entries
        .first()
        .map(|entry| entry.0.clone())
        .ok_or(if is_input {
            AudioError::MissingInputDevice
        } else {
            AudioError::MissingOutputDevice
        })
}

/// Which enumerated device a stored selection means.
///
/// With a name, the name decides: the stored index only breaks a tie between
/// identically named devices. A named device that is no longer present yields
/// `None` (use the system default) rather than whatever now sits at its old
/// index. Selections saved before names were stored fall back to the index.
fn resolve_selected_index(
    devices: &[AudioDeviceInfo],
    selected_index: Option<usize>,
    selected_name: Option<&str>,
) -> Option<usize> {
    match selected_name.filter(|name| !name.is_empty()) {
        Some(name) => {
            let named: Vec<&AudioDeviceInfo> =
                devices.iter().filter(|info| info.name == name).collect();
            named
                .iter()
                .find(|info| Some(info.index) == selected_index)
                .or_else(|| named.first())
                .map(|info| info.index)
        }
        None => selected_index.filter(|index| devices.iter().any(|info| info.index == *index)),
    }
}

fn choose_output_config(
    device: &Device,
    preferred_rate: u32,
) -> Result<(StreamConfig, SampleFormat), AudioError> {
    // Some hosts list a mono range ahead of the stereo one. Taking the first
    // range that fits the rate could open a stereo rig as mono, so prefer the
    // device's own default channel count when a range offers it.
    let default_channels = device
        .default_output_config()
        .ok()
        .map(|config| config.channels());
    let mut rate_match = None;
    let mut fallback = None;
    for range in device.supported_output_configs()? {
        let format = range.sample_format();
        let min_rate = range.min_sample_rate().0;
        let max_rate = range.max_sample_rate().0;
        if preferred_rate >= min_rate && preferred_rate <= max_rate {
            let channels = range.channels();
            let selected = range.with_sample_rate(SampleRate(preferred_rate));
            if Some(channels) == default_channels {
                return Ok((selected.config(), format));
            }
            if rate_match.is_none() {
                rate_match = Some((selected.config(), format));
            }
            continue;
        }
        if fallback.is_none() {
            let selected = range.with_max_sample_rate();
            fallback = Some((selected.config(), format));
        }
    }
    if let Some(config) = rate_match.or(fallback) {
        return Ok(config);
    }
    let default = device.default_output_config()?;
    Ok((default.config(), default.sample_format()))
}

fn choose_input_config(
    device: &Device,
    preferred_rate: u32,
) -> Result<(StreamConfig, SampleFormat), AudioError> {
    // Some hosts list a mono range ahead of the stereo one. Taking the first
    // range that fits the rate could open a stereo rig as mono, so prefer the
    // device's own default channel count when a range offers it.
    let default_channels = device
        .default_input_config()
        .ok()
        .map(|config| config.channels());
    let mut rate_match = None;
    let mut fallback = None;
    for range in device.supported_input_configs()? {
        let format = range.sample_format();
        let min_rate = range.min_sample_rate().0;
        let max_rate = range.max_sample_rate().0;
        if preferred_rate >= min_rate && preferred_rate <= max_rate {
            let channels = range.channels();
            let selected = range.with_sample_rate(SampleRate(preferred_rate));
            if Some(channels) == default_channels {
                return Ok((selected.config(), format));
            }
            if rate_match.is_none() {
                rate_match = Some((selected.config(), format));
            }
            continue;
        }
        if fallback.is_none() {
            let selected = range.with_max_sample_rate();
            fallback = Some((selected.config(), format));
        }
    }
    if let Some(config) = rate_match.or(fallback) {
        return Ok(config);
    }
    let default = device.default_input_config()?;
    Ok((default.config(), default.sample_format()))
}

/// One-octave log chirp centred on `center_hz`, used by the latency test. The
/// band is cut at `max_hz` so a low-rate link never plays above its Nyquist.
fn generate_latency_chirp(
    center_hz: f32,
    duration_secs: f32,
    amplitude: f32,
    sample_rate: u32,
    max_hz: f32,
) -> Vec<f32> {
    let half_octave = std::f32::consts::SQRT_2;
    let (f0, f1) = clamp_sweep_band(center_hz / half_octave, center_hz * half_octave, max_hz);
    generate_log_chirp(f0, f1, duration_secs, amplitude, sample_rate)
}

fn generate_sine(freq_hz: f32, duration_secs: f32, amplitude: f32, sample_rate: u32) -> Vec<f32> {
    let total_samples = ((duration_secs * sample_rate as f32).round() as usize).max(1);
    let fade_len = ((0.01 * sample_rate as f32) as usize)
        .max(1)
        .min(total_samples.saturating_div(2).max(1));
    let mut signal = Vec::with_capacity(total_samples);
    for i in 0..total_samples {
        let t = i as f32 / sample_rate as f32;
        let mut envelope = 1.0;
        if i < fade_len {
            envelope = i as f32 / fade_len as f32;
        } else if i + fade_len >= total_samples {
            envelope = (total_samples - i) as f32 / fade_len as f32;
        }
        let value = (2.0 * PI * freq_hz * t).sin() * amplitude * envelope.clamp(0.0, 1.0);
        signal.push(value);
    }
    signal
}

fn generate_log_chirp(
    f0: f32,
    f1: f32,
    duration_secs: f32,
    amplitude: f32,
    sample_rate: u32,
) -> Vec<f32> {
    let total_samples = ((duration_secs * sample_rate as f32).round() as usize).max(1);
    let mut signal = Vec::with_capacity(total_samples);
    let start = f0.max(1.0);
    let end = f1.max(start + 1.0);
    let k = (end / start).ln() / duration_secs.max(1e-6);
    let fade = (sample_rate as f32 * 0.01) as usize;

    for i in 0..total_samples {
        let t = i as f32 / sample_rate as f32;
        let phase = 2.0 * PI * start * ((k * t).exp() - 1.0) / k.max(1e-6);
        let mut env = 1.0;
        if fade > 0 {
            if i < fade {
                env = i as f32 / fade as f32;
            } else if i + fade >= total_samples {
                env = (total_samples - i) as f32 / fade as f32;
            }
        }
        signal.push(phase.sin() * amplitude * env.clamp(0.0, 1.0));
    }

    signal
}

/// See [`AudioRuntime::max_excitation_hz`]. 0.475 of the lower sample rate
/// leaves a little room below Nyquist for the converters' anti-alias filters.
fn max_excitation_hz(output_rate: u32, input_rate: u32) -> f32 {
    (output_rate.min(input_rate) as f32 * 0.475).min(20_000.0)
}

/// Clamp a sweep band to what the chain can carry. Never panics, whatever the
/// request holds: `f32::clamp` does when its bounds cross, which a start
/// frequency above the ceiling used to trigger.
fn clamp_sweep_band(f0: f32, f1: f32, max_hz: f32) -> (f32, f32) {
    let top = max_hz.max(21.0);
    let start = if f0.is_finite() { f0 } else { 20.0 }.clamp(20.0, top - 1.0);
    let end = if f1.is_finite() { f1 } else { top }.clamp(start + 1.0, top);
    (start, end)
}

fn logspace(start: f32, end: f32, count: usize) -> Vec<f32> {
    if count == 0 {
        return Vec::new();
    }
    if count == 1 {
        return vec![start.max(1.0)];
    }

    let s = start.max(1.0).ln();
    let e = end.max(start + 1.0).ln();
    let step = (e - s) / (count as f32 - 1.0);
    (0..count).map(|i| (s + step * i as f32).exp()).collect()
}

fn mean(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f32>() / values.len() as f32
}

fn standard_deviation(values: &[f32], avg: f32) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let variance = values
        .iter()
        .map(|value| {
            let delta = *value - avg;
            delta * delta
        })
        .sum::<f32>()
        / values.len() as f32;
    variance.sqrt()
}

fn average_option(values: &[Option<f32>]) -> Option<f32> {
    let valid: Vec<f32> = values.iter().filter_map(|v| *v).collect();
    if valid.is_empty() {
        None
    } else {
        Some(mean(&valid))
    }
}

fn average_curves(curves: &[Vec<f32>]) -> Vec<f32> {
    // Skip empty curves (e.g. a single-side capture, or a transient recording
    // failure on one repeat) so they neither blank the result when they land
    // first nor skew the divisor.
    let non_empty: Vec<&Vec<f32>> = curves.iter().filter(|c| !c.is_empty()).collect();
    if non_empty.is_empty() {
        return Vec::new();
    }
    let len = non_empty[0].len();

    let mut acc = vec![0.0f32; len];
    for curve in &non_empty {
        for (idx, value) in curve.iter().enumerate().take(len) {
            acc[idx] += *value;
        }
    }
    for value in &mut acc {
        *value /= non_empty.len() as f32;
    }
    acc
}

/// Peak below which a capture channel counts as digital silence rather than a
/// quiet signal. ~-120 dBFS: under the noise floor of any real analog capture,
/// so only a channel the device wired to nothing lands here.
const DEAD_CHANNEL_PEAK: f32 = 1e-6;

/// A capture channel the device wired to nothing: every sample is digital
/// silence. Real mic input, even in a quiet room, sits far above this.
/// Start of the highest-energy contiguous window of `want` samples.
///
/// Uses a running sum, so the search costs one pass regardless of how long the
/// recording is.
fn strongest_window_start(samples: &[f32], want: usize) -> usize {
    if want == 0 || samples.len() <= want {
        return 0;
    }
    let mut energy: f32 = samples.iter().take(want).map(|value| value * value).sum();
    let mut best_energy = energy;
    let mut best_start = 0usize;
    for start in 1..=(samples.len() - want) {
        let leaving = samples[start - 1];
        let entering = samples[start + want - 1];
        energy += entering * entering - leaving * leaving;
        if energy > best_energy {
            best_energy = energy;
            best_start = start;
        }
    }
    best_start
}

/// The highest-energy contiguous window of `want` samples. Returns the whole
/// input when it is already short enough.
fn strongest_window(samples: &[f32], want: usize) -> Vec<f32> {
    if want == 0 || samples.len() <= want {
        return samples.to_vec();
    }
    let start = strongest_window_start(samples, want);
    samples[start..start + want].to_vec()
}

/// Slice `samples` to the window starting at `start`, padding nothing.
fn window_at(samples: &[f32], start: usize, want: usize) -> Vec<f32> {
    if want == 0 || samples.len() <= want {
        return samples.to_vec();
    }
    let begin = start.min(samples.len().saturating_sub(want));
    samples[begin..begin + want].to_vec()
}

/// Which side of a two-sided capture is really a copy of the other: a mono
/// interface has no second channel, and a dead channel is replaced by the live
/// one downstream. A broken mic looks the same as a mono rig, so callers report
/// it instead of shipping two identical curves as a stereo measurement.
fn mirrored_channel(captured: &[Vec<f32>]) -> Option<&'static str> {
    if captured.len() < 2 || is_dead_channel(&captured[1]) {
        Some("right")
    } else if is_dead_channel(&captured[0]) {
        Some("left")
    } else {
        None
    }
}

fn is_dead_channel(channel: &[f32]) -> bool {
    channel
        .iter()
        .all(|sample| sample.abs() < DEAD_CHANNEL_PEAK)
}

/// Verbatim channel access, with no dead-channel fallback.
///
/// Use this wherever a near-silent channel *is* the measurement — crosstalk
/// leak — because substituting the live channel there does not
/// recover a mono device, it fabricates a result: a perfectly isolated leak
/// channel would come back holding the driven signal and report 0 dB
/// crosstalk. Use [`channel_or_mix`] only where silence means "absent".
fn channel_raw(channels: &[Vec<f32>], channel: usize) -> Vec<f32> {
    channels.get(channel).cloned().unwrap_or_default()
}

fn mixdown_channels(channels: &[Vec<f32>]) -> Vec<f32> {
    if channels.is_empty() {
        return Vec::new();
    }
    // ponytail: many "stereo" USB mics feed channel 0 only and leave the rest
    // at digital silence. Mixing a dead channel in costs 6 dB, so drop it.
    let live: Vec<&Vec<f32>> = channels
        .iter()
        .filter(|channel| !is_dead_channel(channel))
        .collect();
    let used: Vec<&Vec<f32>> = if live.is_empty() {
        channels.iter().collect()
    } else {
        live
    };
    let frames = used.iter().map(|channel| channel.len()).max().unwrap_or(0);
    if frames == 0 {
        return Vec::new();
    }

    let mut mono = Vec::with_capacity(frames);
    let n = used.len() as f32;
    for idx in 0..frames {
        let sum: f32 = used
            .iter()
            .map(|channel| channel.get(idx).copied().unwrap_or(0.0))
            .sum();
        mono.push(sum / n);
    }
    mono
}

fn channel_or_mix(channels: &[Vec<f32>], channel: usize) -> Vec<f32> {
    if channels.is_empty() {
        return Vec::new();
    }
    // A dead channel counts as absent: a mono mic reported as stereo would
    // otherwise render the right curve as pure silence.
    if channel < channels.len()
        && !channels[channel].is_empty()
        && !is_dead_channel(&channels[channel])
    {
        return channels[channel].clone();
    }
    mixdown_channels(channels)
}

fn resolve_output_dir(requested: &Option<String>) -> PathBuf {
    let candidate = requested
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    candidate.unwrap_or_else(default_output_dir)
}

pub fn sanitize_output_name(raw: &str) -> String {
    const WINDOWS_RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    const MAX_NAME_LEN: usize = 200;

    let mut out = String::with_capacity(raw.len().min(MAX_NAME_LEN));
    for ch in raw.trim().chars().take(MAX_NAME_LEN) {
        let invalid =
            matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control();
        if invalid {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let cleaned = out
        .trim_matches(|c| c == ' ' || c == '.')
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return "item".to_string();
    }
    // Strip any extension before checking reserved names
    let stem = cleaned.split('.').next().unwrap_or(&cleaned);
    if WINDOWS_RESERVED.contains(&stem.to_uppercase().as_str()) {
        return format!("_{cleaned}");
    }
    cleaned
}

pub fn resolve_measurement_output_dir(
    requested: &Option<String>,
    item_name: &str,
    run_tag: &str,
) -> PathBuf {
    let base = resolve_output_dir(requested);
    let item = sanitize_output_name(item_name);
    base.join(format!("(({item})-({run_tag}))"))
}

fn default_output_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);

    if let Some(home_dir) = home {
        return home_dir.join("Documents").join("Pawdio Lab Exports");
    }

    std::env::temp_dir().join("pawdio-lab-exports")
}

fn ensure_output_dir(path: &Path) -> Result<(), AudioError> {
    fs::create_dir_all(path).map_err(|err| {
        AudioError::FileExport(format!(
            "failed to create output dir {}: {err}",
            path.display()
        ))
    })
}

fn write_text_file(path: &Path, content: &str) -> Result<(), AudioError> {
    let mut file = File::create(path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
    })?;
    file.write_all(content.as_bytes())
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", path.display())))
}

fn timestamp_filename() -> String {
    timestamp_string()
        .replace('-', "")
        .replace(' ', "_")
        .replace(':', "")
}

fn latency_preset_identity(signal: TestSignalKind, frequency_hz: f32) -> (String, String) {
    match signal {
        TestSignalKind::Chirp => {
            let f = frequency_hz;
            if (f - 200.0).abs() <= 5.0 {
                ("chirp_200".to_string(), "200 Hz Chirp".to_string())
            } else if (f - 5000.0).abs() <= 50.0 {
                ("chirp_5k".to_string(), "5 kHz Chirp".to_string())
            } else if (f - 10_000.0).abs() <= 100.0 {
                ("chirp_10k".to_string(), "10 kHz Chirp".to_string())
            } else {
                ("chirp_custom".to_string(), format!("{f:.0} Hz Chirp"))
            }
        }
    }
}

/// Folder for everything one latency run produces: per-sound plots, the bar
/// chart and the text report. A suite passes one `shared_run_tag` to every
/// preset and to the exports, so they all land together.
fn latency_output_dir(request: &LatencyTestRequest, item_name: &str) -> PathBuf {
    if let Some(shared) = request
        .shared_output_dir
        .as_deref()
        .filter(|dir| !dir.trim().is_empty())
    {
        return PathBuf::from(shared);
    }
    let run_tag = request
        .shared_run_tag
        .clone()
        .unwrap_or_else(timestamp_filename);
    resolve_measurement_output_dir(&request.output_dir, item_name, &run_tag)
}

fn latency_plot_path(output_dir: &Path, preset_key: &str) -> Result<PathBuf, AudioError> {
    ensure_output_dir(output_dir)?;
    Ok(output_dir.join(format!("{preset_key}_plot_{}.png", timestamp_filename())))
}

fn overall_bar_path(output_dir: &Path) -> Result<PathBuf, AudioError> {
    ensure_output_dir(output_dir)?;
    Ok(output_dir.join(format!("overall_bar_{}.png", timestamp_filename())))
}

fn latency_bars_from_suite(suite: &[LatencyExportEntry]) -> Vec<(String, Vec<f32>)> {
    let mut bars = Vec::new();
    for entry in suite {
        let (_, label) = latency_preset_identity(entry.request.signal, entry.request.frequency_hz);
        let delays: Vec<f32> = entry
            .report
            .measurements
            .iter()
            .filter_map(|measurement| measurement.delay_ms)
            .collect();
        if !delays.is_empty() {
            bars.push((label, delays));
        }
    }
    bars
}

fn latency_performance_label(avg: f32) -> (&'static str, &'static str) {
    if avg <= 40.0 {
        (
            "Good (< 40ms)",
            "Your headphones have low latency - suitable for most tasks.",
        )
    } else if avg <= 80.0 {
        (
            "Moderate (40-80ms)",
            "Your headphones have moderate latency - may be noticeable.",
        )
    } else {
        (
            "Poor (> 80ms)",
            "Your headphones have high latency - may cause audio sync issues.",
        )
    }
}

fn latency_consistency_label(std: f32) -> &'static str {
    if std <= 10.0 {
        "Good (low variation)"
    } else if std <= 30.0 {
        "Moderate (some variation)"
    } else {
        "Poor (high variation - check audio setup)"
    }
}

fn build_latency_text_report(request: &LatencyTestRequest, report: &LatencyTestReport) -> String {
    let single = vec![LatencyExportEntry {
        request: request.clone(),
        report: report.clone(),
    }];
    build_latency_suite_text_report(&single)
}

fn build_latency_suite_text_report(suite: &[LatencyExportEntry]) -> String {
    if suite.is_empty() {
        return [
            "============================================================",
            "HEADPHONE DELAY TEST REPORT",
            "============================================================",
            "No latency results available.",
            "============================================================",
            "REPORT END",
            "============================================================",
        ]
        .join("\n");
    }

    let test_date = suite
        .last()
        .map(|entry| entry.report.timestamp_utc.clone())
        .unwrap_or_else(timestamp_string);
    let first_request = &suite[0].request;
    let first_report = &suite[0].report;

    let all_delays: Vec<f32> = suite
        .iter()
        .flat_map(|entry| {
            entry
                .report
                .measurements
                .iter()
                .filter_map(|measurement| measurement.delay_ms)
        })
        .collect();
    let overall_avg = if all_delays.is_empty() {
        0.0
    } else {
        mean(&all_delays)
    };
    let overall_std = if all_delays.is_empty() {
        0.0
    } else {
        standard_deviation(&all_delays, overall_avg)
    };

    let first_offset = first_request.calibrated_offset_ms;
    let same_offset = suite
        .iter()
        .all(|entry| (entry.request.calibrated_offset_ms - first_offset).abs() <= 1e-4);
    let calibration_line = if same_offset {
        format!("Calibration Offset Applied: {first_offset:.4} ms")
    } else {
        "Calibration Offset Applied: Per-sound + global (varies by sound type)".to_string()
    };

    let mut lines = vec![
        "============================================================".to_string(),
        "HEADPHONE DELAY TEST REPORT".to_string(),
        "============================================================".to_string(),
        format!("Test Date: {test_date}"),
        format!("Overall Tests Per Sound Type: {}", first_request.repeats),
        format!("Sample Rate: {} Hz", first_report.input_sample_rate),
        format!(
            "Default Test Signal Buffer Duration: {:.4} seconds (Sine waves use this primarily)",
            first_request.duration_secs
        ),
        calibration_line,
        "".to_string(),
        "".to_string(),
        "==================== OVERALL AVERAGE CALIBRATED DELAY (ALL SOUND TYPES) ===================="
            .to_string(),
        format!("Overall Average Calibrated Delay: {overall_avg:.4} ms"),
        format!("Overall Standard Deviation: {overall_std:.4} ms"),
        format!("Total Successful Tests: {}", all_delays.len()),
        "============================================================".to_string(),
        "".to_string(),
    ];

    for entry in suite {
        let (_, sound_name) =
            latency_preset_identity(entry.request.signal, entry.request.frequency_hz);
        let delays: Vec<f32> = entry
            .report
            .measurements
            .iter()
            .filter_map(|measurement| measurement.delay_ms)
            .collect();
        let avg = if delays.is_empty() {
            None
        } else {
            Some(
                entry
                    .report
                    .average_delay_ms
                    .unwrap_or_else(|| mean(&delays)),
            )
        };
        let std = if delays.is_empty() {
            None
        } else {
            let avg_value = avg.unwrap_or(0.0);
            Some(
                entry
                    .report
                    .std_dev_ms
                    .unwrap_or_else(|| standard_deviation(&delays, avg_value)),
            )
        };

        lines.push(format!(
            "==================== Results for '{}' ====================",
            sound_name
        ));
        lines.push("Individual test results (Calibrated):".to_string());
        lines.push("------------------------------".to_string());
        for measurement in &entry.report.measurements {
            if let Some(value) = measurement.delay_ms {
                lines.push(format!("Test {}: {value:.4} ms", measurement.iteration));
            } else {
                lines.push(format!("Test {}: failed", measurement.iteration));
            }
        }
        lines.push("".to_string());

        lines.push(format!(
            "STATISTICAL ANALYSIS for '{}' (Calibrated):",
            sound_name
        ));
        lines.push("------------------------------".to_string());
        if let (Some(avg_value), Some(std_value)) = (avg, std) {
            let min = delays.iter().copied().fold(f32::INFINITY, f32::min);
            let max = delays.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            lines.push(format!("Average calibrated delay: {avg_value:.4} ms"));
            lines.push(format!("Standard deviation: {std_value:.4} ms"));
            lines.push(format!("Minimum calibrated delay: {min:.4} ms"));
            lines.push(format!("Maximum calibrated delay: {max:.4} ms"));
            lines.push(format!("Range: {:.4} ms", max - min));
        } else {
            lines.push("No successful runs".to_string());
        }
        lines.push("".to_string());

        lines.push(format!(
            "PERFORMANCE ASSESSMENT for '{}' (Calibrated):",
            sound_name
        ));
        lines.push("------------------------------".to_string());
        if let Some(avg_value) = avg {
            let (label, desc) = latency_performance_label(avg_value);
            lines.push(format!("Performance: {label}"));
            lines.push(desc.to_string());
        } else {
            lines.push("Performance: N/A".to_string());
        }
        lines.push("".to_string());

        lines.push(format!("CONSISTENCY ANALYSIS for '{}':", sound_name));
        lines.push("------------------------------".to_string());
        if let Some(std_value) = std {
            lines.push(format!(
                "Consistency: {}",
                latency_consistency_label(std_value)
            ));
        } else {
            lines.push("Consistency: N/A".to_string());
        }
        lines.push("".to_string());

        lines.push(format!(
            "RAW DATA (Calibrated Delays for '{}'):",
            sound_name
        ));
        lines.push("------------------------------".to_string());
        if delays.is_empty() {
            lines.push("Delays (ms): none".to_string());
        } else {
            lines.push(format!(
                "Delays (ms): {}",
                delays
                    .iter()
                    .map(|value| format!("{value:.4}"))
                    .collect::<Vec<String>>()
                    .join(", ")
            ));
        }
        lines.push("".to_string());
    }

    lines.push("============================================================".to_string());
    lines.push("REPORT END".to_string());
    lines.push("============================================================".to_string());
    lines.join("\n")
}

fn y_bounds(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (-1.0, 1.0);
    }
    let min = samples.iter().copied().fold(f32::INFINITY, f32::min);
    let max = samples.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if (max - min).abs() < 1e-6 {
        (min - 0.5, max + 0.5)
    } else {
        let pad = (max - min) * 0.08;
        (min - pad, max + pad)
    }
}

const LATENCY_PLOT_SIZE: (u32, u32) = (1280, 800);
const LATENCY_PLOT_TITLE_HEIGHT: u32 = 64;
const LATENCY_PANEL_MARGIN: u32 = 8;
const LATENCY_LEFT_LABEL_AREA: u32 = 58;
const LATENCY_BOTTOM_LABEL_AREA: u32 = 46;
const LATENCY_MAIN_TITLE_FONT_SIZE: i32 = 34;
const LATENCY_SUBPLOT_TITLE_FONT_SIZE: i32 = 22;
const LATENCY_AXIS_LABEL_FONT_SIZE: i32 = 16;
const LATENCY_TICK_FONT_SIZE: i32 = 13;
const LATENCY_NOTE_FONT_SIZE: i32 = 16;
const LATENCY_WAVEFORM_LINE_WIDTH: u32 = 1;
const LATENCY_CORR_LINE_WIDTH: u32 = 1;
const LATENCY_DELAY_LINE_WIDTH: u32 = 2;
const LATENCY_WAVEFORM_LINE_ALPHA: f64 = 0.72;
const LATENCY_CORR_LINE_ALPHA: f64 = 0.68;
const LATENCY_GRID_ALPHA: f64 = 0.14;
const LATENCY_PEAK_BAND_ALPHA: f64 = 0.12;
const LATENCY_NOTE_BOX_ALPHA: f64 = 0.75;
const LATENCY_NOTE_WIDTH_RATIO: f32 = 0.34;
const LATENCY_NOTE_HEIGHT_RATIO: f32 = 0.18;
const LATENCY_PEAK_BAND_RATIO: f32 = 0.008;
const LATENCY_PEAK_BAND_MIN_MS: f32 = 0.8;
const LATENCY_BG: RGBColor = RGBColor(240, 242, 246);

fn latency_figure_title(sound_name: &str) -> String {
    format!("{sound_name} - Delay Analysis")
}

#[allow(clippy::too_many_arguments)]
fn save_latency_plot(
    path: &Path,
    recorded: &[f32],
    reference: &[f32],
    avg_delay_ms: f32,
    calibrated_offset_ms: f32,
    sample_rate: u32,
    sound_name: &str,
    successful_tests: usize,
) -> Result<(), AudioError> {
    let root = BitMapBackend::new(path, LATENCY_PLOT_SIZE).into_drawing_area();
    root.fill(&LATENCY_BG).map_err(|err| {
        AudioError::FileExport(format!("plot background {}: {err}", path.display()))
    })?;
    let (title_area, body_area) = root.split_vertically(LATENCY_PLOT_TITLE_HEIGHT);
    title_area.fill(&LATENCY_BG).map_err(|err| {
        AudioError::FileExport(format!("plot title background {}: {err}", path.display()))
    })?;
    title_area
        .draw(&Text::new(
            latency_figure_title(sound_name),
            (22, 41),
            ("sans-serif", LATENCY_MAIN_TITLE_FONT_SIZE, FontStyle::Bold)
                .into_font()
                .color(&BLACK),
        ))
        .map_err(|err| AudioError::FileExport(format!("plot title {}: {err}", path.display())))?;
    let areas = body_area.split_evenly((3, 1));

    for area in &areas {
        area.fill(&LATENCY_BG).map_err(|err| {
            AudioError::FileExport(format!("plot panel background {}: {err}", path.display()))
        })?;
    }

    {
        let x_end = (reference.len().max(1) as f32 * 1000.0) / sample_rate.max(1) as f32;
        let (y_min, y_max) = y_bounds(reference);
        let mut chart = ChartBuilder::on(&areas[0])
            .margin(LATENCY_PANEL_MARGIN)
            .caption(
                "Reference Signal",
                (
                    "sans-serif",
                    LATENCY_SUBPLOT_TITLE_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .set_label_area_size(LabelAreaPosition::Left, LATENCY_LEFT_LABEL_AREA)
            .set_label_area_size(LabelAreaPosition::Bottom, LATENCY_BOTTOM_LABEL_AREA)
            .build_cartesian_2d(0f32..x_end.max(1.0), y_min..y_max)
            .map_err(|err| {
                AudioError::FileExport(format!("plot reference {}: {err}", path.display()))
            })?;
        chart
            .configure_mesh()
            .x_desc("Time (ms)")
            .y_desc("Amplitude")
            .axis_desc_style(
                (
                    "sans-serif",
                    LATENCY_AXIS_LABEL_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .axis_style(BLACK.mix(0.72))
            .bold_line_style(BLACK.mix(LATENCY_GRID_ALPHA))
            .max_light_lines(0)
            .light_line_style(BLACK.mix(0.0))
            .label_style(
                ("sans-serif", LATENCY_TICK_FONT_SIZE, FontStyle::Normal)
                    .into_font()
                    .color(&BLACK.mix(0.86)),
            )
            .draw()
            .map_err(|err| {
                AudioError::FileExport(format!("plot mesh {}: {err}", path.display()))
            })?;
        chart
            .draw_series(LineSeries::new(
                reference
                    .iter()
                    .enumerate()
                    .map(|(idx, value)| (idx as f32 * 1000.0 / sample_rate.max(1) as f32, *value)),
                BLUE.mix(LATENCY_WAVEFORM_LINE_ALPHA)
                    .stroke_width(LATENCY_WAVEFORM_LINE_WIDTH),
            ))
            .map_err(|err| {
                AudioError::FileExport(format!("plot line {}: {err}", path.display()))
            })?;
    }

    {
        let x_end = (recorded.len().max(1) as f32 * 1000.0) / sample_rate.max(1) as f32;
        let (y_min, y_max) = y_bounds(recorded);
        let mut chart = ChartBuilder::on(&areas[1])
            .margin(LATENCY_PANEL_MARGIN)
            .caption(
                "Recorded Signal",
                (
                    "sans-serif",
                    LATENCY_SUBPLOT_TITLE_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .set_label_area_size(LabelAreaPosition::Left, LATENCY_LEFT_LABEL_AREA)
            .set_label_area_size(LabelAreaPosition::Bottom, LATENCY_BOTTOM_LABEL_AREA)
            .build_cartesian_2d(0f32..x_end.max(1.0), y_min..y_max)
            .map_err(|err| {
                AudioError::FileExport(format!("plot recorded {}: {err}", path.display()))
            })?;
        chart
            .configure_mesh()
            .x_desc("Time (ms)")
            .y_desc("Amplitude")
            .axis_desc_style(
                (
                    "sans-serif",
                    LATENCY_AXIS_LABEL_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .axis_style(BLACK.mix(0.72))
            .bold_line_style(BLACK.mix(LATENCY_GRID_ALPHA))
            .max_light_lines(0)
            .light_line_style(BLACK.mix(0.0))
            .label_style(
                ("sans-serif", LATENCY_TICK_FONT_SIZE, FontStyle::Normal)
                    .into_font()
                    .color(&BLACK.mix(0.86)),
            )
            .draw()
            .map_err(|err| {
                AudioError::FileExport(format!("plot mesh {}: {err}", path.display()))
            })?;
        chart
            .draw_series(LineSeries::new(
                recorded
                    .iter()
                    .enumerate()
                    .map(|(idx, value)| (idx as f32 * 1000.0 / sample_rate.max(1) as f32, *value)),
                BLUE.mix(LATENCY_WAVEFORM_LINE_ALPHA)
                    .stroke_width(LATENCY_WAVEFORM_LINE_WIDTH),
            ))
            .map_err(|err| {
                AudioError::FileExport(format!("plot line {}: {err}", path.display()))
            })?;
    }

    {
        let corr_points = cross_correlation_points(recorded, reference, sample_rate);
        if corr_points.is_empty() {
            return Ok(());
        }
        let ys: Vec<f32> = corr_points.iter().map(|(_, value)| *value).collect();
        let (y_min, y_max) = y_bounds(&ys);
        let x_min = corr_points.first().map(|(x, _)| *x).unwrap_or(0.0);
        let x_max = corr_points.last().map(|(x, _)| *x).unwrap_or(1.0);
        let y_span = (y_max - y_min).max(1e-6);
        let mut chart = ChartBuilder::on(&areas[2])
            .margin(LATENCY_PANEL_MARGIN)
            .caption(
                "Cross-Correlation",
                (
                    "sans-serif",
                    LATENCY_SUBPLOT_TITLE_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .set_label_area_size(LabelAreaPosition::Left, LATENCY_LEFT_LABEL_AREA)
            .set_label_area_size(LabelAreaPosition::Bottom, LATENCY_BOTTOM_LABEL_AREA)
            .build_cartesian_2d(x_min..x_max.max(x_min + 1.0), y_min..y_max)
            .map_err(|err| {
                AudioError::FileExport(format!("plot correlation {}: {err}", path.display()))
            })?;
        chart
            .configure_mesh()
            .x_desc("Delay (ms)")
            .y_desc("Correlation")
            .axis_desc_style(
                (
                    "sans-serif",
                    LATENCY_AXIS_LABEL_FONT_SIZE,
                    FontStyle::Normal,
                )
                    .into_font()
                    .color(&BLACK),
            )
            .axis_style(BLACK.mix(0.72))
            .bold_line_style(BLACK.mix(LATENCY_GRID_ALPHA))
            .max_light_lines(0)
            .light_line_style(BLACK.mix(0.0))
            .label_style(
                ("sans-serif", LATENCY_TICK_FONT_SIZE, FontStyle::Normal)
                    .into_font()
                    .color(&BLACK.mix(0.86)),
            )
            .draw()
            .map_err(|err| {
                AudioError::FileExport(format!("plot mesh {}: {err}", path.display()))
            })?;

        let (peak_delay_ms, peak_corr_value) =
            corr_points
                .iter()
                .copied()
                .fold((avg_delay_ms, 0.0f32), |best, current| {
                    if current.1.abs() > best.1.abs() {
                        current
                    } else {
                        best
                    }
                });
        let x_span = (x_max - x_min).max(1.0);
        let peak_half_width = (x_span * LATENCY_PEAK_BAND_RATIO).max(LATENCY_PEAK_BAND_MIN_MS);
        let band_left = (peak_delay_ms - peak_half_width).max(x_min);
        let band_right = (peak_delay_ms + peak_half_width).min(x_max);
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [(band_left, y_min), (band_right, y_max)],
                RGBColor(255, 163, 92).mix(LATENCY_PEAK_BAND_ALPHA).filled(),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot peak band {}: {err}", path.display()))
            })?;

        chart
            .draw_series(LineSeries::new(
                corr_points.iter().copied(),
                BLUE.mix(LATENCY_CORR_LINE_ALPHA)
                    .stroke_width(LATENCY_CORR_LINE_WIDTH),
            ))
            .map_err(|err| {
                AudioError::FileExport(format!("plot line {}: {err}", path.display()))
            })?;
        chart
            .draw_series(std::iter::once(Circle::new(
                (peak_delay_ms, peak_corr_value),
                4,
                RGBColor(255, 163, 92).mix(0.65).filled(),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot peak marker {}: {err}", path.display()))
            })?;

        let dash_height = y_span / 26.0;
        let gap_height = dash_height * 0.7;
        let mut y = y_min;
        while y < y_max {
            let y2 = (y + dash_height).min(y_max);
            chart
                .draw_series(std::iter::once(PathElement::new(
                    vec![(avg_delay_ms, y), (avg_delay_ms, y2)],
                    RED.stroke_width(LATENCY_DELAY_LINE_WIDTH),
                )))
                .map_err(|err| {
                    AudioError::FileExport(format!("plot marker {}: {err}", path.display()))
                })?;
            y += dash_height + gap_height;
        }

        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(avg_delay_ms, y_min), (avg_delay_ms, y_min + y_span * 0.08)],
                RED.stroke_width(LATENCY_DELAY_LINE_WIDTH),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot legend marker {}: {err}", path.display()))
            })?
            // The line sits on the correlation's lag axis, so it marks the raw
            // delay; the calibrated figure is in the note box.
            .label(format!("Avg Raw Delay: {avg_delay_ms:.4} ms"))
            .legend(|(x, y)| {
                PathElement::new(
                    vec![(x, y), (x + 24, y)],
                    RED.stroke_width(LATENCY_DELAY_LINE_WIDTH),
                )
            });

        chart
            .configure_series_labels()
            .background_style(WHITE.mix(0.72))
            .border_style(BLACK.mix(0.45))
            .label_font(("sans-serif", LATENCY_TICK_FONT_SIZE, FontStyle::Normal).into_font())
            .draw()
            .map_err(|err| {
                AudioError::FileExport(format!("plot legend {}: {err}", path.display()))
            })?;

        let box_width = x_span * LATENCY_NOTE_WIDTH_RATIO;
        let box_height = y_span * LATENCY_NOTE_HEIGHT_RATIO;
        let use_left_corner = peak_delay_ms > (x_min + x_span * 0.5);
        let box_left = if use_left_corner {
            x_min + x_span * 0.02
        } else {
            x_max - box_width - x_span * 0.02
        };
        let box_right = box_left + box_width;
        let box_top = y_max - y_span * 0.04;
        let box_bottom = box_top - box_height;
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [(box_left, box_bottom), (box_right, box_top)],
                RGBColor(244, 237, 120).mix(LATENCY_NOTE_BOX_ALPHA).filled(),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot note background {}: {err}", path.display()))
            })?;
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [(box_left, box_bottom), (box_right, box_top)],
                RGBColor(120, 110, 40).stroke_width(1),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot note border {}: {err}", path.display()))
            })?;
        chart
            .draw_series(std::iter::once(Text::new(
                format!(
                    "Average Calibrated Delay ({} tests): {:.4} ms",
                    successful_tests.max(1),
                    avg_delay_ms - calibrated_offset_ms
                ),
                (box_left + x_span * 0.012, box_bottom + box_height * 0.5),
                ("sans-serif", LATENCY_NOTE_FONT_SIZE, FontStyle::Normal)
                    .into_font()
                    .color(&BLACK),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("plot note text {}: {err}", path.display()))
            })?;
    }

    root.present()
        .map_err(|err| AudioError::FileExport(format!("plot write {}: {err}", path.display())))
}

fn cross_correlation_points(
    recorded: &[f32],
    reference: &[f32],
    sample_rate: u32,
) -> Vec<(f32, f32)> {
    if recorded.is_empty() || reference.is_empty() || sample_rate == 0 {
        return Vec::new();
    }

    // No window: tapering the recording weights its middle over its start,
    // which drags the peak towards the centre (see `find_delay_ms`).
    let n = (recorded.len() + reference.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut a = vec![
        Complex {
            re: 0.0f32,
            im: 0.0f32
        };
        n
    ];
    let mut b = vec![
        Complex {
            re: 0.0f32,
            im: 0.0f32
        };
        n
    ];
    for (idx, value) in recorded.iter().enumerate() {
        a[idx].re = *value;
    }
    for (idx, value) in reference.iter().enumerate() {
        b[idx].re = *value;
    }
    fft.process(&mut a);
    fft.process(&mut b);

    // Normalized cross-correlation: A * conj(B) / sqrt(E_a * E_b)
    let energy_a: f32 = recorded.iter().map(|s| s * s).sum();
    let energy_b: f32 = reference.iter().map(|s| s * s).sum();
    let norm = (energy_a * energy_b).sqrt().max(1e-12);

    for (left, right) in a.iter_mut().zip(b.iter()) {
        *left *= right.conj();
    }
    ifft.process(&mut a);

    let min_lag = -(reference.len() as isize - 1);
    let max_lag = recorded.len().saturating_sub(1) as isize;
    (min_lag..=max_lag)
        .map(|lag| {
            let idx = if lag < 0 {
                (n as isize + lag) as usize
            } else {
                lag as usize
            };
            (lag as f32 * 1000.0 / sample_rate as f32, a[idx].re / norm)
        })
        .collect()
}

fn save_overall_bar_chart(path: &Path, bars_data: &[(String, Vec<f32>)]) -> Result<(), AudioError> {
    let mut labels = Vec::new();
    let mut means = Vec::new();
    let mut stds = Vec::new();

    for (label, delays) in bars_data {
        if delays.is_empty() {
            continue;
        }
        labels.push(label.clone());
        means.push(mean(delays));
        stds.push(standard_deviation(delays, mean(delays)));
    }
    if labels.is_empty() {
        return Ok(());
    }

    let y_low = means
        .iter()
        .zip(stds.iter())
        .map(|(m, s)| m - s)
        .fold(f32::INFINITY, f32::min);
    let y_high = means
        .iter()
        .zip(stds.iter())
        .map(|(m, s)| m + s)
        .fold(f32::NEG_INFINITY, f32::max);
    let y_span = (y_high - y_low).max(1.0);
    let mut y_min = (y_low - y_span * 0.12).min(0.0);
    let mut y_max = y_high + y_span * 0.20;
    if y_max <= y_min {
        y_max = y_min + 1.0;
    }
    if (y_max - y_min).abs() < 1e-6 {
        y_min -= 1.0;
        y_max += 1.0;
    }

    let bg = RGBColor(230, 230, 230);
    let root = BitMapBackend::new(path, (1100, 640)).into_drawing_area();
    root.fill(&bg).map_err(|err| {
        AudioError::FileExport(format!("bar background {}: {err}", path.display()))
    })?;

    let x_end = labels.len() as f32;
    let mut chart = ChartBuilder::on(&root)
        .margin(24)
        .caption(
            "Average Headphone Calibrated Delay per Sound Type",
            ("sans-serif", 34).into_font().color(&BLACK),
        )
        .set_label_area_size(LabelAreaPosition::Left, 68)
        .set_label_area_size(LabelAreaPosition::Bottom, 86)
        .build_cartesian_2d(0f32..x_end, y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("bar chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Sound Type")
        .y_desc("Average Calibrated Delay (ms)")
        .x_labels(labels.len())
        .x_label_formatter(&|x| {
            let idx = (*x).floor() as usize;
            if idx < labels.len() {
                labels[idx].clone()
            } else {
                String::new()
            }
        })
        .axis_style(BLACK.mix(0.75))
        .bold_line_style(BLACK.mix(0.12))
        .light_line_style(BLACK.mix(0.16))
        .label_style(("sans-serif", 18).into_font().color(&BLACK))
        .draw()
        .map_err(|err| AudioError::FileExport(format!("bar mesh {}: {err}", path.display())))?;

    let y_label_offset = (y_max - y_min) * 0.03;
    for (idx, (mean_value, std_value)) in means.iter().zip(stds.iter()).enumerate() {
        let left = idx as f32 + 0.15;
        let right = idx as f32 + 0.85;
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [(left, 0.0f32.min(*mean_value)), (right, *mean_value)],
                RGBColor(126, 186, 210).filled(),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar draw {}: {err}", path.display())))?;

        let center = idx as f32 + 0.5;
        let low = mean_value - std_value;
        let high = mean_value + std_value;
        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(center, low), (center, high)],
                BLACK.stroke_width(2),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar err {}: {err}", path.display())))?;
        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(center - 0.05, low), (center + 0.05, low)],
                BLACK.stroke_width(2),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("bar err cap {}: {err}", path.display()))
            })?;
        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(center - 0.05, high), (center + 0.05, high)],
                BLACK.stroke_width(2),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar err {}: {err}", path.display())))?;

        chart
            .draw_series(std::iter::once(Text::new(
                format!("{mean_value:.2}"),
                (center, high + y_label_offset),
                ("sans-serif", 22).into_font().color(&BLACK),
            )))
            .map_err(|err| {
                AudioError::FileExport(format!("bar label {}: {err}", path.display()))
            })?;
    }

    root.present()
        .map_err(|err| AudioError::FileExport(format!("bar write {}: {err}", path.display())))
}

fn sweep_y_bounds(curves: &[Vec<f32>]) -> (f32, f32) {
    let mut values = Vec::new();
    for curve in curves {
        values.extend_from_slice(curve);
    }
    y_bounds(&values)
}

const SWEEP_PLOT_WIDTH: u32 = 2400;
const SWEEP_PLOT_HEIGHT: u32 = 1100;
const SWEEP_PLOT_NORMALIZE_FREQ_HZ: f32 = 500.0;
const SWEEP_PLOT_NORMALIZE_TARGET_DB: f32 = 60.0;

fn interpolated_value_at_frequency(freqs: &[f32], values: &[f32], target_hz: f32) -> Option<f32> {
    let len = freqs.len().min(values.len());
    if len == 0 {
        return None;
    }
    if len == 1 {
        return Some(values[0]);
    }

    let target = target_hz.max(0.0);
    if target <= freqs[0] {
        return Some(values[0]);
    }

    for idx in 1..len {
        let left_f = freqs[idx - 1];
        let right_f = freqs[idx];
        if target <= right_f {
            let left_v = values[idx - 1];
            let right_v = values[idx];
            let span = (right_f - left_f).abs().max(1e-12);
            let t = ((target - left_f) / span).clamp(0.0, 1.0);
            return Some(left_v + (right_v - left_v) * t);
        }
    }

    Some(values[len - 1])
}

fn normalize_curve_for_sweep_plot(freqs: &[f32], curve: &[f32]) -> Vec<f32> {
    if freqs.is_empty() || curve.is_empty() {
        return Vec::new();
    }
    let baseline = interpolated_value_at_frequency(freqs, curve, SWEEP_PLOT_NORMALIZE_FREQ_HZ)
        .unwrap_or_else(|| curve[0]);
    let offset = SWEEP_PLOT_NORMALIZE_TARGET_DB - baseline;
    curve.iter().map(|value| *value + offset).collect()
}

fn normalize_curves_for_sweep_plot(freqs: &[f32], curves: &[Vec<f32>]) -> Vec<Vec<f32>> {
    curves
        .iter()
        .map(|curve| normalize_curve_for_sweep_plot(freqs, curve))
        .collect()
}

fn save_sweep_single_plot(
    path: &Path,
    title: &str,
    freqs: &[f32],
    values: &[f32],
) -> Result<(), AudioError> {
    save_sweep_multi_plot(path, title, freqs, &[values.to_vec()])
}

fn save_sweep_multi_plot(
    path: &Path,
    title: &str,
    freqs: &[f32],
    curves: &[Vec<f32>],
) -> Result<(), AudioError> {
    if freqs.len() < 2 || curves.is_empty() {
        return Ok(());
    }

    let normalized_curves = normalize_curves_for_sweep_plot(freqs, curves);
    let normalized_non_empty: Vec<Vec<f32>> = normalized_curves
        .into_iter()
        .filter(|curve| !curve.is_empty())
        .collect();
    if normalized_non_empty.is_empty() {
        return Ok(());
    }

    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let (y_min, y_max) = sweep_y_bounds(&normalized_non_empty);

    let root = BitMapBackend::new(path, (SWEEP_PLOT_WIDTH, SWEEP_PLOT_HEIGHT)).into_drawing_area();
    root.fill(&RGBColor(240, 240, 240)).map_err(|err| {
        AudioError::FileExport(format!("sweep background {}: {err}", path.display()))
    })?;

    let title = format!(
        "{title}  |  normalized to {:.0} Hz @ {:.0} dB",
        SWEEP_PLOT_NORMALIZE_FREQ_HZ, SWEEP_PLOT_NORMALIZE_TARGET_DB
    );

    let mut chart = ChartBuilder::on(&root)
        .margin(28)
        .caption(
            title,
            ("sans-serif", 42).into_font().color(&RGBColor(95, 95, 95)),
        )
        .set_label_area_size(LabelAreaPosition::Left, 100)
        .set_label_area_size(LabelAreaPosition::Bottom, 84)
        .build_cartesian_2d((x_min..x_max).log_scale(), y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("sweep chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("dB")
        .axis_style(RGBColor(125, 125, 125))
        .light_line_style(RGBColor(210, 210, 210))
        .bold_line_style(RGBColor(180, 180, 180))
        .label_style(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(115, 115, 115)),
        )
        .x_label_formatter(&|value| {
            if *value >= 1000.0 {
                format!("{:.0}k", *value / 1000.0)
            } else {
                format!("{value:.0}")
            }
        })
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep mesh {}: {err}", path.display())))?;

    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![
                (x_min, SWEEP_PLOT_NORMALIZE_TARGET_DB),
                (x_max, SWEEP_PLOT_NORMALIZE_TARGET_DB),
            ],
            RGBColor(145, 145, 145).mix(0.7).stroke_width(2),
        )))
        .map_err(|err| {
            AudioError::FileExport(format!("sweep norm-line {}: {err}", path.display()))
        })?;

    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![
                (SWEEP_PLOT_NORMALIZE_FREQ_HZ, y_min),
                (SWEEP_PLOT_NORMALIZE_FREQ_HZ, y_max),
            ],
            RGBColor(175, 175, 175).mix(0.65).stroke_width(2),
        )))
        .map_err(|err| {
            AudioError::FileExport(format!("sweep norm-marker {}: {err}", path.display()))
        })?;

    for (idx, curve) in normalized_non_empty.iter().enumerate() {
        let alpha = if normalized_non_empty.len() > 1 {
            0.35
        } else {
            0.95
        };
        let color = if idx % 2 == 0 {
            RGBColor(13, 73, 176).mix(alpha)
        } else {
            RGBColor(23, 95, 201).mix(alpha)
        };
        chart
            .draw_series(LineSeries::new(
                freqs.iter().zip(curve.iter()).map(|(x, y)| (*x, *y)),
                color.stroke_width(if normalized_non_empty.len() > 1 { 2 } else { 5 }),
            ))
            .map_err(|err| {
                AudioError::FileExport(format!("sweep line {}: {err}", path.display()))
            })?;
    }

    root.present()
        .map_err(|err| AudioError::FileExport(format!("sweep write {}: {err}", path.display())))
}

fn save_sweep_lr_avg_plot(
    path: &Path,
    freqs: &[f32],
    left: &[f32],
    right: &[f32],
) -> Result<(), AudioError> {
    if freqs.len() < 2 || left.is_empty() || right.is_empty() {
        return Ok(());
    }

    let left_norm = normalize_curve_for_sweep_plot(freqs, left);
    let right_norm = normalize_curve_for_sweep_plot(freqs, right);
    if left_norm.is_empty() || right_norm.is_empty() {
        return Ok(());
    }

    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let (y_min, y_max) = sweep_y_bounds(&[left_norm.clone(), right_norm.clone()]);

    let root = BitMapBackend::new(path, (SWEEP_PLOT_WIDTH, SWEEP_PLOT_HEIGHT)).into_drawing_area();
    root.fill(&RGBColor(240, 240, 240)).map_err(|err| {
        AudioError::FileExport(format!("sweep background {}: {err}", path.display()))
    })?;

    let title = format!(
        "Left/Right Average Frequency Response  |  normalized to {:.0} Hz @ {:.0} dB",
        SWEEP_PLOT_NORMALIZE_FREQ_HZ, SWEEP_PLOT_NORMALIZE_TARGET_DB
    );

    let mut chart = ChartBuilder::on(&root)
        .margin(28)
        .caption(
            title,
            ("sans-serif", 42).into_font().color(&RGBColor(95, 95, 95)),
        )
        .set_label_area_size(LabelAreaPosition::Left, 100)
        .set_label_area_size(LabelAreaPosition::Bottom, 84)
        .build_cartesian_2d((x_min..x_max).log_scale(), y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("sweep chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("dB")
        .axis_style(RGBColor(125, 125, 125))
        .light_line_style(RGBColor(210, 210, 210))
        .bold_line_style(RGBColor(180, 180, 180))
        .label_style(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(115, 115, 115)),
        )
        .x_label_formatter(&|value| {
            if *value >= 1000.0 {
                format!("{:.0}k", *value / 1000.0)
            } else {
                format!("{value:.0}")
            }
        })
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep mesh {}: {err}", path.display())))?;

    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![
                (x_min, SWEEP_PLOT_NORMALIZE_TARGET_DB),
                (x_max, SWEEP_PLOT_NORMALIZE_TARGET_DB),
            ],
            RGBColor(145, 145, 145).mix(0.7).stroke_width(2),
        )))
        .map_err(|err| {
            AudioError::FileExport(format!("sweep norm-line {}: {err}", path.display()))
        })?;

    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![
                (SWEEP_PLOT_NORMALIZE_FREQ_HZ, y_min),
                (SWEEP_PLOT_NORMALIZE_FREQ_HZ, y_max),
            ],
            RGBColor(175, 175, 175).mix(0.65).stroke_width(2),
        )))
        .map_err(|err| {
            AudioError::FileExport(format!("sweep norm-marker {}: {err}", path.display()))
        })?;

    chart
        .draw_series(LineSeries::new(
            freqs.iter().zip(left_norm.iter()).map(|(x, y)| (*x, *y)),
            RGBColor(12, 67, 170).stroke_width(5),
        ))
        .map_err(|err| AudioError::FileExport(format!("sweep left {}: {err}", path.display())))?
        .label("Left")
        .legend(|(x, y)| {
            PathElement::new(
                vec![(x, y), (x + 36, y)],
                RGBColor(12, 67, 170).stroke_width(5),
            )
        });

    chart
        .draw_series(LineSeries::new(
            freqs.iter().zip(right_norm.iter()).map(|(x, y)| (*x, *y)),
            RGBColor(27, 95, 195).stroke_width(4),
        ))
        .map_err(|err| AudioError::FileExport(format!("sweep right {}: {err}", path.display())))?
        .label("Right")
        .legend(|(x, y)| {
            PathElement::new(
                vec![(x, y), (x + 36, y)],
                RGBColor(27, 95, 195).stroke_width(4),
            )
        });

    chart
        .configure_series_labels()
        .border_style(RGBColor(170, 170, 170))
        .background_style(RGBColor(236, 236, 236).mix(0.8))
        .label_font(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(110, 110, 110)),
        )
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep legend {}: {err}", path.display())))?;

    root.present()
        .map_err(|err| AudioError::FileExport(format!("sweep write {}: {err}", path.display())))
}

/// Render the combined "All Sweeps" / "Average of All" / "Left+Right Average"
/// plots from both sides' curve data.
///
/// Guided mono mode captures each earphone in a separate sweep, so the
/// per-sweep plots only contain one side. This regenerates the aggregate plots
/// using the merged left+right curves so both buds are accounted for.
#[allow(clippy::too_many_arguments)]
/// Write the Sweep FR plots and Squiglink files for a set of curves.
///
/// One place builds every export, whether the curves come from a single
/// backend run or from the sweeps a user accepted one by one in the UI, so the
/// files always describe exactly the curves they are named after.
pub fn write_sweep_outputs(
    output_dir: &Path,
    ts: &str,
    save_plots: bool,
    save_squiglink: bool,
    grid: &[f32],
    mags_l: &[Vec<f32>],
    mags_r: &[Vec<f32>],
) -> Result<serde_json::Map<String, Value>, AudioError> {
    let mut files = serde_json::Map::<String, Value>::new();
    let left_avg = average_curves(mags_l);
    let right_avg = average_curves(mags_r);
    let mut all_curves = Vec::new();
    all_curves.extend(mags_l.iter().filter(|curve| !curve.is_empty()).cloned());
    all_curves.extend(mags_r.iter().filter(|curve| !curve.is_empty()).cloned());
    let avg_all = average_curves(&all_curves);
    let has_left_data = !left_avg.is_empty();
    let has_right_data = !right_avg.is_empty();
    let mut insert = |key: &str, path: &Path| {
        files.insert(key.to_string(), Value::String(path.display().to_string()));
    };

    if save_plots {
        ensure_output_dir(output_dir)?;

        if has_left_data {
            let path = output_dir.join(format!("sweep_fr_left_avg_{ts}.png"));
            save_sweep_single_plot(&path, "Left Average Frequency Response", grid, &left_avg)?;
            insert("plot_left_avg", &path);
            let path = output_dir.join(format!("sweep_fr_left_all_{ts}.png"));
            save_sweep_multi_plot(&path, "Left All Sweeps Frequency Response", grid, mags_l)?;
            insert("plot_left_all", &path);
        }

        if has_right_data {
            let path = output_dir.join(format!("sweep_fr_right_avg_{ts}.png"));
            save_sweep_single_plot(&path, "Right Average Frequency Response", grid, &right_avg)?;
            insert("plot_right_avg", &path);
            let path = output_dir.join(format!("sweep_fr_right_all_{ts}.png"));
            save_sweep_multi_plot(&path, "Right All Sweeps Frequency Response", grid, mags_r)?;
            insert("plot_right_all", &path);
        }

        if !all_curves.is_empty() {
            let path = output_dir.join(format!("sweep_fr_all_{ts}.png"));
            save_sweep_multi_plot(&path, "All Sweeps Frequency Response", grid, &all_curves)?;
            insert("plot_all", &path);
        }

        if has_left_data && has_right_data {
            let path = output_dir.join(format!("sweep_fr_lr_avg_{ts}.png"));
            save_sweep_lr_avg_plot(&path, grid, &left_avg, &right_avg)?;
            insert("plot_lr_avg", &path);
        }

        if !avg_all.is_empty() {
            let path = output_dir.join(format!("sweep_fr_avg_all_{ts}.png"));
            save_sweep_single_plot(&path, "Average of All Frequency Response", grid, &avg_all)?;
            insert("plot_avg_all", &path);
        }
    }

    if save_squiglink {
        ensure_output_dir(output_dir)?;
        let squig_files =
            save_squiglink_files(output_dir, ts, grid, &left_avg, &right_avg, &avg_all)?;
        for (key, value) in squig_files {
            files.insert(key, Value::String(value));
        }
    }

    Ok(files)
}

const ANC_PLOT_Y_MIN: f32 = -40.0;
const ANC_PLOT_Y_MAX: f32 = 10.0;

fn anc_curve_colors(index: usize) -> RGBColor {
    match index % 4 {
        0 => RGBColor(13, 73, 176),   // blue — ANC
        1 => RGBColor(0, 155, 140),   // teal — Transparency
        2 => RGBColor(120, 120, 120), // gray — Passive/reference
        _ => RGBColor(180, 80, 30),   // amber — extra
    }
}

fn save_anc_single_plot(
    path: &Path,
    freqs: &[f32],
    attenuation_l: &[f32],
    attenuation_r: &[f32],
    mode_label: &str,
) -> Result<(), AudioError> {
    if freqs.len() < 2 || (attenuation_l.is_empty() && attenuation_r.is_empty()) {
        return Ok(());
    }
    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);

    let root = BitMapBackend::new(path, (SWEEP_PLOT_WIDTH, SWEEP_PLOT_HEIGHT)).into_drawing_area();
    root.fill(&RGBColor(240, 240, 240)).map_err(|err| {
        AudioError::FileExport(format!("anc background {}: {err}", path.display()))
    })?;

    let title = format!("{mode_label} — Noise Attenuation (dB)");
    let mut chart = ChartBuilder::on(&root)
        .margin(28)
        .caption(
            title,
            ("sans-serif", 42).into_font().color(&RGBColor(95, 95, 95)),
        )
        .set_label_area_size(LabelAreaPosition::Left, 100)
        .set_label_area_size(LabelAreaPosition::Bottom, 84)
        .build_cartesian_2d((x_min..x_max).log_scale(), ANC_PLOT_Y_MIN..ANC_PLOT_Y_MAX)
        .map_err(|err| AudioError::FileExport(format!("anc chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("Attenuation (dB)")
        .axis_style(RGBColor(125, 125, 125))
        .light_line_style(RGBColor(210, 210, 210))
        .bold_line_style(RGBColor(180, 180, 180))
        .label_style(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(115, 115, 115)),
        )
        .x_label_formatter(&|value| {
            if *value >= 1000.0 {
                format!("{:.0}k", *value / 1000.0)
            } else {
                format!("{value:.0}")
            }
        })
        .draw()
        .map_err(|err| AudioError::FileExport(format!("anc mesh {}: {err}", path.display())))?;

    // 0 dB reference line
    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![(x_min, 0.0_f32), (x_max, 0.0_f32)],
            RGBColor(145, 145, 145).mix(0.8).stroke_width(2),
        )))
        .map_err(|err| AudioError::FileExport(format!("anc zeroline {}: {err}", path.display())))?;

    // L channel (absent after a right-ear-only guided capture)
    if !attenuation_l.is_empty() {
        chart
            .draw_series(LineSeries::new(
                freqs
                    .iter()
                    .zip(attenuation_l.iter())
                    .map(|(x, y)| (*x, y.clamp(ANC_PLOT_Y_MIN, ANC_PLOT_Y_MAX))),
                RGBColor(13, 73, 176).stroke_width(3),
            ))
            .map_err(|err| AudioError::FileExport(format!("anc left {}: {err}", path.display())))?
            .label("Left")
            .legend(|(x, y)| {
                PathElement::new(
                    vec![(x, y), (x + 36, y)],
                    RGBColor(13, 73, 176).stroke_width(3),
                )
            });
    }

    if !attenuation_r.is_empty() {
        chart
            .draw_series(LineSeries::new(
                freqs
                    .iter()
                    .zip(attenuation_r.iter())
                    .map(|(x, y)| (*x, y.clamp(ANC_PLOT_Y_MIN, ANC_PLOT_Y_MAX))),
                RGBColor(27, 95, 195).mix(0.6).stroke_width(2),
            ))
            .map_err(|err| AudioError::FileExport(format!("anc right {}: {err}", path.display())))?
            .label("Right")
            .legend(|(x, y)| {
                PathElement::new(
                    vec![(x, y), (x + 36, y)],
                    RGBColor(27, 95, 195).stroke_width(2),
                )
            });
    }

    chart
        .configure_series_labels()
        .border_style(RGBColor(170, 170, 170))
        .background_style(RGBColor(236, 236, 236).mix(0.8))
        .label_font(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(110, 110, 110)),
        )
        .draw()
        .map_err(|err| AudioError::FileExport(format!("anc legend {}: {err}", path.display())))?;

    root.present()
        .map_err(|err| AudioError::FileExport(format!("anc write {}: {err}", path.display())))
}

/// curves: slice of (mode_label, attenuation_db) — one entry per mode, L channel only for combined
fn save_anc_combined_plot(
    path: &Path,
    freqs: &[f32],
    curves: &[(&str, &[f32])],
) -> Result<(), AudioError> {
    if freqs.len() < 2 || curves.is_empty() {
        return Ok(());
    }

    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);

    let root = BitMapBackend::new(path, (SWEEP_PLOT_WIDTH, SWEEP_PLOT_HEIGHT)).into_drawing_area();
    root.fill(&RGBColor(240, 240, 240)).map_err(|err| {
        AudioError::FileExport(format!("anc-combined background {}: {err}", path.display()))
    })?;

    let mut chart = ChartBuilder::on(&root)
        .margin(28)
        .caption(
            "ANC / Transparency — Noise Attenuation (dB)",
            ("sans-serif", 42).into_font().color(&RGBColor(95, 95, 95)),
        )
        .set_label_area_size(LabelAreaPosition::Left, 100)
        .set_label_area_size(LabelAreaPosition::Bottom, 84)
        .build_cartesian_2d((x_min..x_max).log_scale(), ANC_PLOT_Y_MIN..ANC_PLOT_Y_MAX)
        .map_err(|err| {
            AudioError::FileExport(format!("anc-combined chart {}: {err}", path.display()))
        })?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("Attenuation (dB)")
        .axis_style(RGBColor(125, 125, 125))
        .light_line_style(RGBColor(210, 210, 210))
        .bold_line_style(RGBColor(180, 180, 180))
        .label_style(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(115, 115, 115)),
        )
        .x_label_formatter(&|value| {
            if *value >= 1000.0 {
                format!("{:.0}k", *value / 1000.0)
            } else {
                format!("{value:.0}")
            }
        })
        .draw()
        .map_err(|err| {
            AudioError::FileExport(format!("anc-combined mesh {}: {err}", path.display()))
        })?;

    // 0 dB reference line
    chart
        .draw_series(std::iter::once(PathElement::new(
            vec![(x_min, 0.0_f32), (x_max, 0.0_f32)],
            RGBColor(145, 145, 145).mix(0.8).stroke_width(2),
        )))
        .map_err(|err| {
            AudioError::FileExport(format!("anc-combined zeroline {}: {err}", path.display()))
        })?;

    for (idx, (label, curve)) in curves.iter().enumerate() {
        let color = anc_curve_colors(idx);
        chart
            .draw_series(LineSeries::new(
                freqs
                    .iter()
                    .zip(curve.iter())
                    .map(|(x, y)| (*x, y.clamp(ANC_PLOT_Y_MIN, ANC_PLOT_Y_MAX))),
                color.stroke_width(2),
            ))
            .map_err(|err| {
                AudioError::FileExport(format!("anc-combined line {}: {err}", path.display()))
            })?
            .label(*label)
            .legend(move |(x, y)| {
                PathElement::new(vec![(x, y), (x + 36, y)], color.stroke_width(2))
            });
    }

    chart
        .configure_series_labels()
        .border_style(RGBColor(170, 170, 170))
        .background_style(RGBColor(236, 236, 236).mix(0.8))
        .label_font(
            ("sans-serif", 28)
                .into_font()
                .color(&RGBColor(110, 110, 110)),
        )
        .draw()
        .map_err(|err| {
            AudioError::FileExport(format!("anc-combined legend {}: {err}", path.display()))
        })?;

    root.present().map_err(|err| {
        AudioError::FileExport(format!("anc-combined write {}: {err}", path.display()))
    })
}

/// Public entry: generate per-mode + combined ANC attenuation plots.
/// modes: slice of (mode_key, label, attenuation_l, attenuation_r)
/// baseline_freqs: the shared frequency grid from captures
/// Returns list of (key, file_path) for generated files.
pub fn save_anc_plots(
    output_dir: &Path,
    timestamp: &str,
    freqs: &[f32],
    modes: &[(&str, &str, Vec<f32>, Vec<f32>)],
) -> Result<Vec<(String, String)>, AudioError> {
    let mut result = Vec::new();

    // Renderer-supplied mode keys and timestamps land in a filename, so they go
    // through the same sanitizer the squiglink export uses.
    let tag = sanitize_output_name(timestamp);

    // Per-mode single plots
    for (key, label, att_l, att_r) in modes {
        if att_l.is_empty() && att_r.is_empty() {
            // Nothing to draw, so no file: never report a path that was not written.
            continue;
        }
        let filename = format!("anc_{}_{tag}.png", sanitize_output_name(key));
        let path = output_dir.join(&filename);
        save_anc_single_plot(&path, freqs, att_l, att_r, label)?;
        result.push((format!("plot_{key}"), path.display().to_string()));
    }

    // Combined plot
    if modes.len() > 1 {
        let combined_filename = format!("anc_combined_{tag}.png");
        let combined_path = output_dir.join(&combined_filename);
        // One curve per mode: the left ear, or the right when only the right
        // was captured, rather than an empty line.
        let curve_refs: Vec<(&str, &[f32])> = modes
            .iter()
            .map(|(_, label, att_l, att_r)| {
                let curve = if att_l.is_empty() { att_r } else { att_l };
                (*label, curve.as_slice())
            })
            .collect();
        save_anc_combined_plot(&combined_path, freqs, &curve_refs)?;
        result.push((
            "plot_combined".to_string(),
            combined_path.display().to_string(),
        ));
    }

    Ok(result)
}

/// Write a single ANC attenuation squiglink-compatible TXT file.
pub fn save_anc_squiglink(
    path: &Path,
    mode_label: &str,
    freqs: &[f32],
    attenuation_db: &[f32],
) -> Result<(), AudioError> {
    let mut f = File::create(path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
    })?;
    writeln!(f, "# PawdioLab ANC Attenuation — {mode_label}")
        .map_err(|err| AudioError::FileExport(format!("write {}: {err}", path.display())))?;
    writeln!(f, "# Frequency(Hz)\tAttenuation(dB)")
        .map_err(|err| AudioError::FileExport(format!("write {}: {err}", path.display())))?;
    for (freq, att) in freqs.iter().zip(attenuation_db.iter()) {
        writeln!(f, "{freq:.2}\t{att:.3}")
            .map_err(|err| AudioError::FileExport(format!("write {}: {err}", path.display())))?;
    }
    Ok(())
}

fn save_squiglink_files(
    output_dir: &Path,
    timestamp: &str,
    freqs: &[f32],
    left_db: &[f32],
    right_db: &[f32],
    avg_db: &[f32],
) -> Result<Vec<(String, String)>, AudioError> {
    let mut result = Vec::new();

    if !left_db.is_empty() {
        let path = output_dir.join(format!("squiglink_left_{timestamp}.txt"));
        let mut f = File::create(&path).map_err(|err| {
            AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
        })?;
        writeln!(f, "# PawdioLab Frequency Response - Left Channel").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        writeln!(f, "# Frequency(Hz)\tAmplitude(dB)").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        for (freq, amp) in freqs.iter().zip(left_db.iter()) {
            writeln!(f, "{freq:.2}\t{amp:.3}").map_err(|err| {
                AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
            })?;
        }
        result.push(("squiglink_left".to_string(), path.display().to_string()));
    }

    if !right_db.is_empty() {
        let path = output_dir.join(format!("squiglink_right_{timestamp}.txt"));
        let mut f = File::create(&path).map_err(|err| {
            AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
        })?;
        writeln!(f, "# PawdioLab Frequency Response - Right Channel").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        writeln!(f, "# Frequency(Hz)\tAmplitude(dB)").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        for (freq, amp) in freqs.iter().zip(right_db.iter()) {
            writeln!(f, "{freq:.2}\t{amp:.3}").map_err(|err| {
                AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
            })?;
        }
        result.push(("squiglink_right".to_string(), path.display().to_string()));
    }

    if !avg_db.is_empty() {
        let path = output_dir.join(format!("squiglink_avg_{timestamp}.txt"));
        let mut f = File::create(&path).map_err(|err| {
            AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
        })?;
        writeln!(f, "# PawdioLab Frequency Response - Average (L+R)").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        writeln!(f, "# Frequency(Hz)\tAmplitude(dB)").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
        for (freq, amp) in freqs.iter().zip(avg_db.iter()) {
            writeln!(f, "{freq:.2}\t{amp:.3}").map_err(|err| {
                AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
            })?;
        }
        result.push(("squiglink_avg".to_string(), path.display().to_string()));
    }

    if !left_db.is_empty() && !right_db.is_empty() {
        let path = output_dir.join(format!("squiglink_both_{timestamp}.txt"));
        write_squiglink_both_file(&path, freqs, left_db, right_db)?;
        result.push(("squiglink_both".to_string(), path.display().to_string()));
    }

    Ok(result)
}

fn write_squiglink_both_file(
    path: &Path,
    freqs: &[f32],
    left_db: &[f32],
    right_db: &[f32],
) -> Result<(), AudioError> {
    let mut f = File::create(path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
    })?;
    writeln!(f, "# PawdioLab Frequency Response - Both Channels").map_err(|err| {
        AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
    })?;
    writeln!(f, "# Frequency(Hz)\tLeft(dB)\tRight(dB)").map_err(|err| {
        AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
    })?;
    for ((freq, left), right) in freqs.iter().zip(left_db.iter()).zip(right_db.iter()) {
        writeln!(f, "{freq:.2}\t{left:.3}\t{right:.3}").map_err(|err| {
            AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
        })?;
    }
    Ok(())
}

fn timestamp_string() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let days = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);

    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let power = samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    power.sqrt()
}

fn dbfs(samples: &[f32]) -> f32 {
    let level = rms(samples).max(1e-12);
    20.0 * level.log10()
}

fn resample_cubic(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == 0 || dst_rate == 0 {
        return Vec::new();
    }
    if src_rate == dst_rate {
        return input.to_vec();
    }

    let output_len =
        ((input.len() as f64) * (dst_rate as f64) / (src_rate as f64)).round() as usize;
    let output_len = output_len.max(1);
    let ratio = src_rate as f64 / dst_rate as f64;

    let n = input.len();

    // Pre-compute second derivatives for cubic spline
    let mut y2 = vec![0.0f64; n];
    if n > 2 {
        let mut sigma = vec![0.0f64; n];
        y2[0] = 0.0;
        sigma[0] = 0.0;

        for i in 1..(n - 1) {
            let denom_sig = input[i + 1] as f64 - input[i - 1] as f64;
            let sig = if denom_sig.abs() < 1e-12 {
                0.5 // fallback for flat/duplicated samples
            } else {
                (input[i] as f64 - input[i - 1] as f64) / denom_sig
            };
            sigma[i] = sig;
            let denom_y2 = input[i + 1] as f64 - input[i] as f64;
            let eps = 1e-10f64.max(sig * sig);
            y2[i] = if denom_y2.abs() < 1e-12 {
                0.0
            } else {
                (3.0 * eps - 3.0 * sig) / ((eps + 2.0) * denom_y2)
            };
        }
        y2[n - 1] = 0.0;

        for i in (1..n).rev() {
            let un = if i >= n - 1 {
                1.0f64
            } else {
                let denom_un = input[i + 1] as f64 - input[i - 1] as f64;
                if denom_un.abs() < 1e-12 {
                    0.5
                } else {
                    (input[i + 1] as f64 - input[i] as f64) / denom_un
                }
            };
            y2[i - 1] = (un * y2[i - 1] - 0.5 * y2[i]) / (un + 1.0);
        }
    }

    let mut output = vec![0.0f32; output_len];
    for (idx, sample) in output.iter_mut().enumerate() {
        let source_pos = idx as f64 * ratio;
        let x = source_pos.floor() as usize;
        let frac = (source_pos - x as f64) as f32;

        if x == 0 {
            // At or before first sample
            *sample = input[0];
        } else if x >= n - 1 {
            // At or after last sample
            *sample = input[n - 1];
        } else {
            // Cubic spline interpolation
            let x0 = x - 1;
            let x1 = x;
            let x2 = x + 1;
            let x3 = x + 2;

            let _h0 = if x0 < n {
                (source_pos - x0 as f64) as f32
            } else {
                0.0
            };
            let h1 = if x1 < n {
                (source_pos - x1 as f64) as f32
            } else {
                0.0
            };
            let h2 = if x2 < n {
                (source_pos - x2 as f64) as f32
            } else {
                0.0
            };
            let _h3 = if x3 < n {
                (source_pos - x3 as f64) as f32
            } else {
                0.0
            };

            let a = -h2 * h2 * h2 / 6.0 + h2 * h2 / 2.0 - h2 * h1 / 3.0;
            let b = h2 * h2 * h2 / 2.0 - h2 * h2 + h2 * h1 / 2.0;
            let c = -h2 * h2 * h2 / 6.0 + h2 * h1 / 6.0;
            let d = -h1 * h1 * h1 / 6.0 + h1 * h1 / 2.0 - h1 * h2 / 3.0;

            let val = if x0 < n && x3 < n {
                input[x0] as f64 * a as f64
                    + input[x1] as f64 * b as f64
                    + input[x2] as f64 * c as f64
                    + input[x3] as f64 * d as f64
            } else if x1 < n && x2 < n {
                input[x1] as f64 * (1.0 - frac) as f64 + input[x2] as f64 * frac as f64
            } else {
                input[x] as f64
            };

            *sample = (val as f32).clamp(-1.0, 1.0);
        }
    }

    output
}

fn align_to_reference(
    recorded: &[f32],
    target_len: usize,
    delay_ms: Option<f32>,
    sample_rate: u32,
) -> Vec<f32> {
    let shift_samples = delay_ms
        .map(|delay| (delay.max(0.0) / 1000.0 * sample_rate as f32).round() as usize)
        .unwrap_or(0);

    let mut aligned = vec![0.0f32; target_len];
    if recorded.is_empty() || target_len == 0 {
        return aligned;
    }

    for (idx, slot) in aligned.iter_mut().enumerate() {
        let src = shift_samples + idx;
        if src < recorded.len() {
            *slot = recorded[src];
        }
    }

    aligned
}

/// Left and right excitation windows plus the round-trip delay each channel's
/// markers implied. An empty window means that side was not captured in this
/// pass, which is how guided mono mode reports the ear it skipped.
type MarkedSweepCapture = (Vec<f32>, Vec<f32>, Option<f32>, Option<f32>);

/// Run one marker-locked sweep capture and return the drift-corrected windows.
fn capture_marked_sweep(
    runtime: &AudioRuntime,
    chirp: &[f32],
    ref_signal: &[f32],
    mono_mode: bool,
    mono_side: SweepMonoSide,
    last_diagnostics: &mut Option<AlignmentDiagnostics>,
    mirrored_side: &mut Option<&'static str>,
) -> Result<MarkedSweepCapture, AudioError> {
    // The markers put the excitation at a known offset inside the playback
    // buffer, so the distance between where it was expected and where it landed
    // is the round-trip delay.
    let delay_ms = |diagnostics: &AlignmentDiagnostics, excitation_at: usize| -> f32 {
        let offset = diagnostics.excitation_start_sample as i64 - excitation_at as i64;
        offset as f32 * 1000.0 / runtime.input_rate.max(1) as f32
    };

    if mono_mode {
        let mut left = Vec::new();
        let mut right = Vec::new();
        let mut delay_left = None;
        let mut delay_right = None;

        if mono_side != SweepMonoSide::Right {
            let (captured, layout) = runtime.play_and_record_marked(
                chirp.to_vec(),
                ref_signal,
                OutputRouting::LeftOnly,
            )?;
            let raw = channel_or_mix(&captured, 0);
            let aligned = runtime.align_channel(&layout, &raw)?;
            if let Some(diagnostics) = aligned.diagnostics.as_ref() {
                delay_left = Some(delay_ms(diagnostics, layout.excitation_at));
                *last_diagnostics = Some(diagnostics.clone());
            }
            left = aligned.samples;
        }

        if mono_side != SweepMonoSide::Left {
            let (captured, layout) = runtime.play_and_record_marked(
                chirp.to_vec(),
                ref_signal,
                OutputRouting::RightOnly,
            )?;
            let raw = if captured.len() > 1 {
                channel_or_mix(&captured, 1)
            } else {
                channel_or_mix(&captured, 0)
            };
            let aligned = runtime.align_channel(&layout, &raw)?;
            if let Some(diagnostics) = aligned.diagnostics.as_ref() {
                delay_right = Some(delay_ms(diagnostics, layout.excitation_at));
                *last_diagnostics = Some(diagnostics.clone());
            }
            right = aligned.samples;
        }

        return Ok((left, right, delay_left, delay_right));
    }

    let (captured, layout) =
        runtime.play_and_record_marked(chirp.to_vec(), ref_signal, OutputRouting::Both)?;
    *mirrored_side = mirrored_side.or(mirrored_channel(&captured));

    let raw_left = channel_or_mix(&captured, 0);
    let aligned_left = runtime.align_channel(&layout, &raw_left)?;
    let delay_left = aligned_left
        .diagnostics
        .as_ref()
        .map(|diagnostics| delay_ms(diagnostics, layout.excitation_at));
    if let Some(diagnostics) = aligned_left.diagnostics.as_ref() {
        *last_diagnostics = Some(diagnostics.clone());
    }

    if captured.len() > 1 {
        let raw_right = channel_or_mix(&captured, 1);
        let aligned_right = runtime.align_channel(&layout, &raw_right)?;
        let delay_right = aligned_right
            .diagnostics
            .as_ref()
            .map(|diagnostics| delay_ms(diagnostics, layout.excitation_at));
        Ok((
            aligned_left.samples,
            aligned_right.samples,
            delay_left,
            delay_right,
        ))
    } else {
        // A mono interface: both curves come from the one captured channel.
        Ok((
            aligned_left.samples.clone(),
            aligned_left.samples,
            delay_left,
            delay_left,
        ))
    }
}

fn frequency_response_curve(
    recorded: &[f32],
    reference: &[f32],
    sample_rate: u32,
    grid: &[f32],
) -> Vec<f32> {
    if recorded.is_empty() || reference.is_empty() || grid.is_empty() {
        return Vec::new();
    }

    let n = recorded
        .len()
        .max(reference.len())
        .next_power_of_two()
        .max(1024);
    let rec_mag = magnitude_spectrum(recorded, n);
    let ref_mag = magnitude_spectrum(reference, n);

    grid.iter()
        .map(|freq| {
            let bin = ((*freq / sample_rate as f32) * n as f32).round() as usize;
            let clamped = bin.min(rec_mag.len().saturating_sub(1));
            let rec = rec_mag[clamped].max(1e-9);
            let refv = ref_mag[clamped].max(1e-9);
            20.0 * (rec / refv).log10()
        })
        .collect()
}

fn magnitude_spectrum(signal: &[f32], n: usize) -> Vec<f32> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let mut buffer = vec![
        Complex {
            re: 0.0f32,
            im: 0.0f32
        };
        n
    ];

    for (idx, value) in signal.iter().enumerate().take(n) {
        buffer[idx].re = *value;
    }

    fft.process(&mut buffer);

    // Scale to one-sided amplitude spectrum: 2/N for non-DC/Nyquist bins
    let scale = 2.0 / n as f32;
    let half = n / 2 + 1;
    buffer
        .into_iter()
        .take(half)
        .enumerate()
        .map(|(i, c)| {
            let mag = (c.re * c.re + c.im * c.im).sqrt();
            // DC (i=0) and Nyquist (i=half-1) are not doubled
            if i == 0 || i == half - 1 {
                mag / n as f32
            } else {
                mag * scale
            }
        })
        .collect()
}

fn compute_thd(samples: &[f32], fundamental_hz: f32, sample_rate: u32, harmonics: usize) -> f32 {
    if samples.is_empty() || fundamental_hz <= 0.0 || sample_rate == 0 {
        return 0.0;
    }

    let n = samples.len().next_power_of_two().max(1024);
    let mut windowed = vec![0.0f32; samples.len()];
    // Periodic Hann window (N denominator, not N-1) so endpoints are non-zero
    let len_f = samples.len() as f32;
    for (idx, sample) in samples.iter().enumerate() {
        let w = 0.5 * (1.0 - (2.0 * PI * idx as f32 / len_f).cos());
        windowed[idx] = *sample * w;
    }

    let spectrum = magnitude_spectrum(&windowed, n);
    let bin_for = |freq: f32| -> usize {
        let raw = (freq / sample_rate as f32 * n as f32).round() as usize;
        raw.min(spectrum.len().saturating_sub(1))
    };

    let fund = spectrum[bin_for(fundamental_hz)].max(1e-12);
    let mut harmonic_power = 0.0f32;
    for k in 2..=harmonics {
        let harmonic = fundamental_hz * k as f32;
        if harmonic >= sample_rate as f32 / 2.0 {
            break;
        }
        let mag = spectrum[bin_for(harmonic)];
        harmonic_power += mag * mag;
    }

    (harmonic_power.sqrt() / fund) * 100.0
}

/// Returns the delay in milliseconds by which `recorded` lags `reference`.
/// Positive return = recorded arrives after reference (the normal case for output→input latency).
///
/// The peak is taken from the envelope of the cross-correlation (the magnitude
/// of its analytic signal), not from the raw correlation. For a band-limited
/// excitation the raw correlation oscillates at the carrier, and neighbouring
/// cycles are nearly as tall as the true one, so a little noise or a phase
/// shift in the device picks a peak a whole cycle away. The envelope has one
/// hump centred on the group delay, which is what latency means.
///
/// Neither signal is windowed. A taper over the recording weights its middle
/// over its start, and a short real delay sits near the start, so any window
/// here drags the answer towards the centre of the capture.
fn find_delay_ms(recorded: &[f32], reference: &[f32], sample_rate: u32) -> Option<f32> {
    if recorded.is_empty() || reference.is_empty() || sample_rate == 0 {
        return None;
    }

    let n = (recorded.len() + reference.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let zero = Complex {
        re: 0.0f32,
        im: 0.0f32,
    };
    let mut a = vec![zero; n];
    let mut b = vec![zero; n];
    for (idx, value) in recorded.iter().enumerate() {
        a[idx].re = *value;
    }
    for (idx, value) in reference.iter().enumerate() {
        b[idx].re = *value;
    }

    fft.process(&mut a);
    fft.process(&mut b);

    // Cross-spectrum, then keep only the positive frequencies (doubled) so the
    // inverse transform is the analytic correlation. Its magnitude is the
    // envelope.
    let half = n / 2;
    for (idx, (x, y)) in a.iter_mut().zip(b.iter()).enumerate() {
        *x *= y.conj();
        if idx > half {
            *x = zero;
        } else if idx > 0 && idx < half {
            *x *= 2.0;
        }
    }

    ifft.process(&mut a);

    // Only non-negative lags: the recording cannot lead the playback.
    let search_len = recorded.len().min(n);
    let envelope: Vec<f32> = a
        .iter()
        .take(search_len)
        .map(|c| (c.re * c.re + c.im * c.im).sqrt())
        .collect();

    let (best_idx, best_val) =
        envelope
            .iter()
            .copied()
            .enumerate()
            .fold((0usize, f32::MIN), |best, (idx, value)| {
                if value > best.1 {
                    (idx, value)
                } else {
                    best
                }
            });
    if best_val <= 1e-12 {
        return None;
    }

    let mut best_idx_f = best_idx as f32;
    if best_idx > 0 && best_idx + 1 < envelope.len() {
        let y1 = envelope[best_idx - 1];
        let y2 = envelope[best_idx];
        let y3 = envelope[best_idx + 1];
        let denom = y1 - 2.0 * y2 + y3;
        if denom.abs() > 1e-12 {
            let frac = (y1 - y3) / (2.0 * denom);
            best_idx_f += frac.clamp(-1.0, 1.0);
        }
    }

    Some(best_idx_f * 1000.0 / sample_rate as f32)
}

#[allow(clippy::too_many_arguments)]
fn play_and_record(
    output_device: &Device,
    input_device: &Device,
    signal: Vec<f32>,
    routing: OutputRouting,
    output_config: StreamConfig,
    output_format: SampleFormat,
    input_config: StreamConfig,
    input_format: SampleFormat,
    record_duration_secs: f32,
    expected_input_channels: usize,
    cancel: &AtomicBool,
) -> Result<Vec<Vec<f32>>, AudioError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AudioError::Cancelled);
    }
    let signal = Arc::new(signal);
    let output_pos = Arc::new(AtomicUsize::new(0));
    let output_channels = output_config.channels as usize;
    // A mono output stream (AirPods in hands-free mode, mono WASAPI endpoints)
    // has no right channel, so a side-only routing would play pure silence.
    let routing = if output_channels < 2 {
        OutputRouting::Both
    } else {
        routing
    };
    let input_channels = expected_input_channels.max(1);

    let target_frames =
        (record_duration_secs.max(0.05) * input_config.sample_rate.0 as f32).round() as usize;
    let target_frames = target_frames.max(1);
    let recorded = Arc::new(Mutex::new(
        (0..input_channels)
            .map(|_| Vec::<f32>::with_capacity(target_frames))
            .collect::<Vec<_>>(),
    ));

    let err_fn = |err| {
        eprintln!("audio stream error: {err}");
    };

    let input_stream = build_input_stream(
        input_device,
        &input_config,
        input_format,
        recorded.clone(),
        target_frames,
        err_fn,
    )?;

    let output_stream = build_output_stream(
        output_device,
        &output_config,
        output_format,
        signal,
        output_pos,
        routing,
        output_channels,
        err_fn,
    )?;

    input_stream.play()?;
    output_stream.play()?;

    let playback_secs = target_frames as f32 / input_config.sample_rate.0 as f32;
    let guard = 0.1f32;
    // Sleep in short slices so a Stop request ends the capture promptly
    // rather than after the whole recording.
    let deadline = std::time::Instant::now() + Duration::from_secs_f32(playback_secs + guard);
    let mut cancelled = false;
    loop {
        let now = std::time::Instant::now();
        if now >= deadline {
            break;
        }
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        std::thread::sleep((deadline - now).min(Duration::from_millis(20)));
    }

    output_stream.pause().ok();
    input_stream.pause().ok();
    drop(output_stream);
    drop(input_stream);

    if cancelled {
        return Err(AudioError::Cancelled);
    }

    let captured = recorded
        .lock()
        .map_err(|_| AudioError::RecordingError("capture buffer was poisoned".to_string()))?
        .clone();

    Ok(captured)
}

#[allow(clippy::too_many_arguments)]
fn build_output_stream(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    signal: Arc<Vec<f32>>,
    position: Arc<AtomicUsize>,
    routing: OutputRouting,
    channels: usize,
    err_fn: impl Fn(cpal::StreamError) + Send + 'static + Copy,
) -> Result<Stream, AudioError> {
    match format {
        SampleFormat::F32 => {
            let signal_c = signal.clone();
            let pos_c = position.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [f32], _| {
                    write_output_f32(data, channels, &signal_c, &pos_c, routing);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::I16 => {
            let signal_c = signal.clone();
            let pos_c = position.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [i16], _| {
                    write_output_i16(data, channels, &signal_c, &pos_c, routing);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U16 => {
            let signal_c = signal.clone();
            let pos_c = position.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [u16], _| {
                    write_output_u16(data, channels, &signal_c, &pos_c, routing);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U8 => {
            let signal_c = signal.clone();
            let pos_c = position.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [u8], _| {
                    write_output_u8(data, channels, &signal_c, &pos_c, routing);
                },
                err_fn,
                None,
            )?)
        }
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn write_output_f32(
    data: &mut [f32],
    channels: usize,
    signal: &[f32],
    position: &AtomicUsize,
    routing: OutputRouting,
) {
    for frame in data.chunks_mut(channels.max(1)) {
        let idx = position.fetch_add(1, Ordering::SeqCst);
        let mono = signal.get(idx).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let (left, right) = route_sample(mono, routing);
        for (ch, sample) in frame.iter_mut().enumerate() {
            *sample = if ch == 0 {
                left
            } else if ch == 1 {
                right
            } else if ch % 2 == 0 {
                left
            } else {
                right
            };
        }
    }
}

fn write_output_i16(
    data: &mut [i16],
    channels: usize,
    signal: &[f32],
    position: &AtomicUsize,
    routing: OutputRouting,
) {
    for frame in data.chunks_mut(channels.max(1)) {
        let idx = position.fetch_add(1, Ordering::SeqCst);
        let mono = signal.get(idx).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let (left, right) = route_sample(mono, routing);
        for (ch, sample) in frame.iter_mut().enumerate() {
            let value = if ch == 0 {
                left
            } else if ch == 1 {
                right
            } else if ch % 2 == 0 {
                left
            } else {
                right
            };
            *sample = (value * i16::MAX as f32) as i16;
        }
    }
}

fn write_output_u16(
    data: &mut [u16],
    channels: usize,
    signal: &[f32],
    position: &AtomicUsize,
    routing: OutputRouting,
) {
    for frame in data.chunks_mut(channels.max(1)) {
        let idx = position.fetch_add(1, Ordering::SeqCst);
        let mono = signal.get(idx).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let (left, right) = route_sample(mono, routing);
        for (ch, sample) in frame.iter_mut().enumerate() {
            let value = if ch == 0 {
                left
            } else if ch == 1 {
                right
            } else if ch % 2 == 0 {
                left
            } else {
                right
            };
            *sample = ((value * 0.5 + 0.5) * u16::MAX as f32) as u16;
        }
    }
}

fn write_output_u8(
    data: &mut [u8],
    channels: usize,
    signal: &[f32],
    position: &AtomicUsize,
    routing: OutputRouting,
) {
    for frame in data.chunks_mut(channels.max(1)) {
        let idx = position.fetch_add(1, Ordering::SeqCst);
        let mono = signal.get(idx).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let (left, right) = route_sample(mono, routing);
        for (ch, sample) in frame.iter_mut().enumerate() {
            let value = if ch == 0 {
                left
            } else if ch == 1 {
                right
            } else if ch % 2 == 0 {
                left
            } else {
                right
            };
            *sample = ((value * 0.5 + 0.5) * u8::MAX as f32) as u8;
        }
    }
}

fn route_sample(sample: f32, routing: OutputRouting) -> (f32, f32) {
    match routing {
        OutputRouting::Both => (sample, sample),
        OutputRouting::LeftOnly => (sample, 0.0),
        OutputRouting::RightOnly => (0.0, sample),
    }
}

struct PinkNoiseState {
    b0: f32,
    b1: f32,
    b2: f32,
    b3: f32,
    b4: f32,
    b5: f32,
    b6: f32,
    seed: u64,
    gain: f32,
}

impl PinkNoiseState {
    fn new(gain: f32) -> Self {
        let seed = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64
            ^ 0x9E37_79B9_7F4A_7C15;

        Self {
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            b3: 0.0,
            b4: 0.0,
            b5: 0.0,
            b6: 0.0,
            seed: if seed == 0 {
                0xA5A5_A5A5_A5A5_A5A5
            } else {
                seed
            },
            gain: gain.clamp(0.0, 1.0),
        }
    }

    fn next_white(&mut self) -> f32 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.seed = x;
        let unit = (x as f64) / (u64::MAX as f64);
        (unit as f32) * 2.0 - 1.0
    }

    fn next_sample(&mut self) -> f32 {
        let x = self.next_white();
        self.b0 = 0.99886 * self.b0 + x * 0.055_517_9;
        self.b1 = 0.99332 * self.b1 + x * 0.075_075_9;
        self.b2 = 0.96900 * self.b2 + x * 0.153_852;
        self.b3 = 0.86650 * self.b3 + x * 0.310_485_6;
        self.b4 = 0.55000 * self.b4 + x * 0.532_952_2;
        self.b5 = -0.7616 * self.b5 - x * 0.016_898_0;
        let y = self.b0 + self.b1 + self.b2 + self.b3 + self.b4 + self.b5 + self.b6 + x * 0.5362;
        self.b6 = x * 0.115_926;

        // 0.11 keeps the Paul Kellet filter output in a comfortable playback range.
        (y * 0.11 * self.gain).clamp(-1.0, 1.0)
    }
}

fn build_pink_output_stream(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    routing: OutputRouting,
    channels: usize,
    noise_state: Arc<Mutex<PinkNoiseState>>,
    err_fn: impl Fn(cpal::StreamError) + Send + 'static + Copy,
) -> Result<Stream, AudioError> {
    match format {
        SampleFormat::F32 => {
            let state = noise_state.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [f32], _| {
                    write_pink_f32(data, channels, routing, &state);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::I16 => {
            let state = noise_state.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [i16], _| {
                    write_pink_i16(data, channels, routing, &state);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U16 => {
            let state = noise_state.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [u16], _| {
                    write_pink_u16(data, channels, routing, &state);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U8 => {
            let state = noise_state.clone();
            Ok(device.build_output_stream(
                config,
                move |data: &mut [u8], _| {
                    write_pink_u8(data, channels, routing, &state);
                },
                err_fn,
                None,
            )?)
        }
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn write_pink_f32(
    data: &mut [f32],
    channels: usize,
    routing: OutputRouting,
    noise_state: &Arc<Mutex<PinkNoiseState>>,
) {
    if let Ok(mut state) = noise_state.lock() {
        for frame in data.chunks_mut(channels.max(1)) {
            let mono = state.next_sample();
            let (left, right) = route_sample(mono, routing);
            for (ch, sample) in frame.iter_mut().enumerate() {
                *sample = if ch == 0 {
                    left
                } else if ch == 1 {
                    right
                } else if ch % 2 == 0 {
                    left
                } else {
                    right
                };
            }
        }
    } else {
        data.fill(0.0);
    }
}

fn write_pink_i16(
    data: &mut [i16],
    channels: usize,
    routing: OutputRouting,
    noise_state: &Arc<Mutex<PinkNoiseState>>,
) {
    if let Ok(mut state) = noise_state.lock() {
        for frame in data.chunks_mut(channels.max(1)) {
            let mono = state.next_sample();
            let (left, right) = route_sample(mono, routing);
            for (ch, sample) in frame.iter_mut().enumerate() {
                let value = if ch == 0 {
                    left
                } else if ch == 1 {
                    right
                } else if ch % 2 == 0 {
                    left
                } else {
                    right
                };
                *sample = (value * i16::MAX as f32) as i16;
            }
        }
    } else {
        data.fill(0);
    }
}

fn write_pink_u16(
    data: &mut [u16],
    channels: usize,
    routing: OutputRouting,
    noise_state: &Arc<Mutex<PinkNoiseState>>,
) {
    if let Ok(mut state) = noise_state.lock() {
        for frame in data.chunks_mut(channels.max(1)) {
            let mono = state.next_sample();
            let (left, right) = route_sample(mono, routing);
            for (ch, sample) in frame.iter_mut().enumerate() {
                let value = if ch == 0 {
                    left
                } else if ch == 1 {
                    right
                } else if ch % 2 == 0 {
                    left
                } else {
                    right
                };
                *sample = ((value * 0.5 + 0.5) * u16::MAX as f32) as u16;
            }
        }
    } else {
        data.fill(u16::MAX / 2);
    }
}

fn write_pink_u8(
    data: &mut [u8],
    channels: usize,
    routing: OutputRouting,
    noise_state: &Arc<Mutex<PinkNoiseState>>,
) {
    if let Ok(mut state) = noise_state.lock() {
        for frame in data.chunks_mut(channels.max(1)) {
            let mono = state.next_sample();
            let (left, right) = route_sample(mono, routing);
            for (ch, sample) in frame.iter_mut().enumerate() {
                let value = if ch == 0 {
                    left
                } else if ch == 1 {
                    right
                } else if ch % 2 == 0 {
                    left
                } else {
                    right
                };
                *sample = ((value * 0.5 + 0.5) * u8::MAX as f32) as u8;
            }
        }
    } else {
        data.fill(u8::MAX / 2);
    }
}

struct MonitorStats {
    current_dbfs: f32,
    peak_dbfs: f32,
    clip_count: u32,
    sample_rate: u32,
    recent_mono: Vec<f32>,
    rough_fr_hz: Vec<f32>,
    rough_fr_db: Vec<f32>,
}

fn build_monitor_stream(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    channels: usize,
    stats: Arc<Mutex<MonitorStats>>,
    err_fn: impl Fn(cpal::StreamError) + Send + 'static + Copy,
) -> Result<Stream, AudioError> {
    match format {
        SampleFormat::F32 => {
            let stats_c = stats.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[f32], _| {
                    read_monitor_f32(data, channels, &stats_c);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::I16 => {
            let stats_c = stats.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[i16], _| {
                    read_monitor_i16(data, channels, &stats_c);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U16 => {
            let stats_c = stats.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[u16], _| {
                    read_monitor_u16(data, channels, &stats_c);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U8 => {
            let stats_c = stats.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[u8], _| {
                    read_monitor_u8(data, channels, &stats_c);
                },
                err_fn,
                None,
            )?)
        }
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn update_monitor_stats(samples: &[f32], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    if samples.is_empty() {
        return;
    }

    let channels = channels.max(1);
    // Channels wired to nothing are left out of the mix, as they are for
    // measurements (`mixdown_channels`): averaging a dead channel in would read
    // a mono mic on a stereo interface 6 dB low.
    let live: Vec<bool> = (0..channels)
        .map(|channel| {
            samples
                .iter()
                .skip(channel)
                .step_by(channels)
                .any(|sample| sample.abs() >= DEAD_CHANNEL_PEAK)
        })
        .collect();
    let any_live = live.iter().any(|is_live| *is_live);

    let mut frame_count = 0usize;
    let mut sum_sq = 0.0f32;
    let mut clips = 0u32;
    let mut mono_samples = Vec::with_capacity(samples.len() / channels + 1);

    for frame in samples.chunks(channels) {
        if frame.is_empty() {
            continue;
        }
        let mut sum = 0.0f32;
        let mut used = 0usize;
        for (channel, sample) in frame.iter().enumerate() {
            if !any_live || live.get(channel).copied().unwrap_or(false) {
                sum += *sample;
                used += 1;
            }
        }
        let mono = sum / used.max(1) as f32;
        mono_samples.push(mono);
        sum_sq += mono * mono;
        // Clipping happens per channel. Checking the averaged mix instead
        // halves a clipped channel next to a quiet one and never flags it.
        if frame.iter().any(|sample| sample.abs() >= 0.98) {
            clips += 1;
        }
        frame_count += 1;
    }

    if frame_count == 0 {
        return;
    }

    let rms_value = (sum_sq / frame_count as f32).sqrt().max(1e-12);
    let current = 20.0 * rms_value.log10();

    if let Ok(mut state) = stats.lock() {
        state.current_dbfs = current;
        if current > state.peak_dbfs {
            state.peak_dbfs = current;
        }
        state.clip_count = state.clip_count.saturating_add(clips);
        state.recent_mono.extend(mono_samples);
        let max_len = 8192usize;
        if state.recent_mono.len() > max_len {
            let drop_count = state.recent_mono.len() - max_len;
            state.recent_mono.drain(0..drop_count);
        }
    }
}

fn compute_monitor_rough_fr_db(samples: &[f32], sample_rate: u32, freq_grid: &[f32]) -> Vec<f32> {
    if samples.len() < 512 || sample_rate == 0 || freq_grid.is_empty() {
        return Vec::new();
    }

    let n = samples.len().min(8192).next_power_of_two().max(1024);
    let start = samples.len().saturating_sub(n);
    let mut windowed = vec![0.0f32; n];
    let denom = (n.saturating_sub(1)).max(1) as f32;
    for (i, value) in samples[start..].iter().enumerate().take(n) {
        let w = 0.5 - 0.5 * (2.0 * PI * i as f32 / denom).cos();
        windowed[i] = *value * w;
    }

    let spectrum = magnitude_spectrum(&windowed, n);
    let max_idx = spectrum.len().saturating_sub(1);
    let mut rough = Vec::with_capacity(freq_grid.len());
    for freq in freq_grid {
        let bin_f = (*freq / sample_rate as f32) * n as f32;
        let bin_lo = (bin_f.floor() as usize).min(max_idx);
        let bin_hi = (bin_lo + 1).min(max_idx);
        let frac = (bin_f - bin_lo as f32).clamp(0.0, 1.0);
        let db_lo = 20.0 * spectrum[bin_lo].max(1e-12).log10();
        let db_hi = 20.0 * spectrum[bin_hi].max(1e-12).log10();
        // Pink noise carries equal power per octave, so on a linear FFT grid
        // each bin's level falls 3 dB per octave. Undo that tilt, or a
        // perfectly flat device reads as a steady downward slope.
        let pink_tilt = 10.0 * freq.max(1.0).log10();
        rough.push(db_lo * (1.0 - frac) + db_hi * frac + pink_tilt);
    }

    let baseline = trimmed_mean(&rough, 4);
    rough
        .into_iter()
        .map(|v| (v - baseline).clamp(-20.0, 20.0))
        .collect()
}

fn trimmed_mean(values: &[f32], trim: usize) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    if values.len() <= trim * 2 {
        return mean(values);
    }
    let mut sorted: Vec<f32> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let slice = &sorted[trim..sorted.len() - trim];
    mean(slice)
}

fn read_monitor_f32(data: &[f32], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    update_monitor_stats(data, channels, stats);
}

fn read_monitor_i16(data: &[i16], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    let converted: Vec<f32> = data
        .iter()
        .map(|sample| *sample as f32 / i16::MAX as f32)
        .collect();
    update_monitor_stats(&converted, channels, stats);
}

fn read_monitor_u16(data: &[u16], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    let converted: Vec<f32> = data
        .iter()
        .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
        .collect();
    update_monitor_stats(&converted, channels, stats);
}

fn read_monitor_u8(data: &[u8], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    let converted: Vec<f32> = data
        .iter()
        .map(|sample| (*sample as f32 / u8::MAX as f32) * 2.0 - 1.0)
        .collect();
    update_monitor_stats(&converted, channels, stats);
}

fn build_input_stream(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    recorded: Arc<Mutex<Vec<Vec<f32>>>>,
    target_frames: usize,
    err_fn: impl Fn(cpal::StreamError) + Send + 'static + Copy,
) -> Result<Stream, AudioError> {
    let channels = config.channels as usize;

    match format {
        SampleFormat::F32 => {
            let rec = recorded.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[f32], _| {
                    read_input_f32(data, channels, &rec, target_frames);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::I16 => {
            let rec = recorded.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[i16], _| {
                    read_input_i16(data, channels, &rec, target_frames);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U16 => {
            let rec = recorded.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[u16], _| {
                    read_input_u16(data, channels, &rec, target_frames);
                },
                err_fn,
                None,
            )?)
        }
        SampleFormat::U8 => {
            let rec = recorded.clone();
            Ok(device.build_input_stream(
                config,
                move |data: &[u8], _| {
                    read_input_u8(data, channels, &rec, target_frames);
                },
                err_fn,
                None,
            )?)
        }
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn read_input_f32(
    data: &[f32],
    channels: usize,
    recorded: &Arc<Mutex<Vec<Vec<f32>>>>,
    target: usize,
) {
    if let Ok(mut out) = recorded.lock() {
        if out.is_empty() || out[0].len() >= target {
            return;
        }
        for frame in data.chunks(channels.max(1)) {
            if out[0].len() >= target {
                break;
            }
            for ch in 0..out.len() {
                let sample = frame.get(ch).copied().unwrap_or_else(|| frame[0]);
                out[ch].push(sample);
            }
        }
    }
}

fn read_input_i16(
    data: &[i16],
    channels: usize,
    recorded: &Arc<Mutex<Vec<Vec<f32>>>>,
    target: usize,
) {
    if let Ok(mut out) = recorded.lock() {
        if out.is_empty() || out[0].len() >= target {
            return;
        }
        for frame in data.chunks(channels.max(1)) {
            if out[0].len() >= target {
                break;
            }
            for ch in 0..out.len() {
                let sample = frame.get(ch).copied().unwrap_or_else(|| frame[0]);
                out[ch].push(sample as f32 / i16::MAX as f32);
            }
        }
    }
}

fn read_input_u16(
    data: &[u16],
    channels: usize,
    recorded: &Arc<Mutex<Vec<Vec<f32>>>>,
    target: usize,
) {
    if let Ok(mut out) = recorded.lock() {
        if out.is_empty() || out[0].len() >= target {
            return;
        }
        for frame in data.chunks(channels.max(1)) {
            if out[0].len() >= target {
                break;
            }
            for ch in 0..out.len() {
                let sample = frame.get(ch).copied().unwrap_or_else(|| frame[0]);
                out[ch].push((sample as f32 / u16::MAX as f32) * 2.0 - 1.0);
            }
        }
    }
}

fn read_input_u8(
    data: &[u8],
    channels: usize,
    recorded: &Arc<Mutex<Vec<Vec<f32>>>>,
    target: usize,
) {
    if let Ok(mut out) = recorded.lock() {
        if out.is_empty() || out[0].len() >= target {
            return;
        }
        for frame in data.chunks(channels.max(1)) {
            if out[0].len() >= target {
                break;
            }
            for ch in 0..out.len() {
                let sample = frame.get(ch).copied().unwrap_or_else(|| frame[0]);
                out[ch].push((sample as f32 / u8::MAX as f32) * 2.0 - 1.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::Rng;
    use std::f32::consts::PI;

    #[test]
    fn magnitude_spectrum_returns_half_plus_one_bins() {
        let n = 64usize;
        let signal: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * i as f32 / n as f32).sin())
            .collect();
        let mag = magnitude_spectrum(&signal, n);
        assert_eq!(mag.len(), n / 2 + 1);
    }

    #[test]
    fn resample_cubic_output_length() {
        let input: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        let output = resample_cubic(&input, 44100, 48000);
        let expected = (100.0_f64 * 48000.0 / 44100.0).ceil() as usize;
        // Allow ±1 for rounding
        assert!((output.len() as isize - expected as isize).abs() <= 1);
    }

    #[test]
    fn find_delay_ms_known_delay() {
        // Use a sine burst in the middle of each buffer so the Hann window doesn't zero it out
        let sample_rate = 44100u32;
        let delay_samples = 10usize;
        let len = 256usize;
        let mid = len / 4;

        // Reference: sine burst starting at `mid`
        let mut reference = vec![0.0f32; len];
        for k in 0..32 {
            reference[mid + k] =
                (2.0 * std::f32::consts::PI * 1000.0 * (mid + k) as f32 / sample_rate as f32).sin();
        }

        // Recorded is same burst shifted by delay_samples
        let mut recorded = vec![0.0f32; len];
        for k in 0..32 {
            let dst = mid + k + delay_samples;
            if dst < len {
                recorded[dst] = reference[mid + k];
            }
        }

        let delay_ms = find_delay_ms(&recorded, &reference, sample_rate);
        let expected_ms = delay_samples as f32 * 1000.0 / sample_rate as f32;
        let result = delay_ms.expect("should detect delay");
        assert!(
            (result - expected_ms).abs() < 0.5,
            "delay {result:.3}ms expected ~{expected_ms:.3}ms"
        );
    }

    /// Place `reference` at `delay_samples` inside a recording laid out the way
    /// the latency test records it (signal plus margin), with optional noise.
    fn delayed_capture(
        reference: &[f32],
        delay_samples: usize,
        record_secs: f32,
        sample_rate: u32,
        noise: f32,
    ) -> Vec<f32> {
        let mut rng = rand::thread_rng();
        let mut recorded = vec![0.0f32; (record_secs * sample_rate as f32) as usize];
        for (idx, value) in reference.iter().enumerate() {
            if delay_samples + idx < recorded.len() {
                recorded[delay_samples + idx] = value * 0.3;
            }
        }
        if noise > 0.0 {
            for sample in recorded.iter_mut() {
                *sample += rng.gen_range(-noise..noise);
            }
        }
        recorded
    }

    #[test]
    fn latency_chirps_measure_known_delays_in_the_real_layout() {
        // The latency test records duration + margin (0.5 s + 1.0 s by
        // default). A windowed estimator used to report ~130 ms too much for
        // tone signals in exactly this layout.
        for sample_rate in [44_100u32, 48_000] {
            for center in [200.0f32, 5000.0, 10_000.0] {
                let reference = generate_latency_chirp(center, 0.5, 0.85, sample_rate, 20_000.0);
                for delay_ms in [5.0f32, 20.0, 60.0, 200.0] {
                    let delay = (delay_ms / 1000.0 * sample_rate as f32).round() as usize;
                    let expected = delay as f32 * 1000.0 / sample_rate as f32;
                    let recorded = delayed_capture(&reference, delay, 1.5, sample_rate, 0.003);
                    let measured = find_delay_ms(&recorded, &reference, sample_rate)
                        .expect("delay should be found");
                    assert!(
                        (measured - expected).abs() < 0.1,
                        "{center} Hz chirp @ {sample_rate}: expected {expected:.3} ms, got {measured:.3} ms"
                    );
                }
            }
        }
    }

    #[test]
    fn short_delay_click_is_not_lost_to_noise() {
        // A single-sample click whose response arrives near the start of the
        // capture used to lose to noise in the middle of it, because a window
        // over the recording weighted the middle ~250x more than the start.
        let sample_rate = 48_000u32;
        let mut reference = vec![0.0f32; sample_rate as usize / 2];
        reference[480] = 0.85;
        let delay = (0.020 * sample_rate as f32) as usize;
        let mut recorded = delayed_capture(&[], 0, 1.5, sample_rate, 0.01);
        for k in 0..200 {
            let sign = if k % 2 == 0 { 1.0 } else { -0.5 };
            recorded[480 + delay + k] += 0.2 * (-(k as f32) / 20.0).exp() * sign;
        }
        let measured = find_delay_ms(&recorded, &reference, sample_rate).unwrap();
        assert!(
            (measured - 20.0).abs() < 0.5,
            "expected ~20 ms, got {measured:.3} ms"
        );
    }

    #[test]
    fn latency_preset_identity_names_the_three_chirps() {
        let key = |f| latency_preset_identity(TestSignalKind::Chirp, f).0;
        assert_eq!(key(200.0), "chirp_200");
        assert_eq!(key(5000.0), "chirp_5k");
        assert_eq!(key(10_000.0), "chirp_10k");
        assert_eq!(key(1234.0), "chirp_custom");
    }

    #[test]
    fn latency_chirp_spans_one_octave_around_its_centre() {
        let sample_rate = 48_000u32;
        let chirp = generate_latency_chirp(5000.0, 0.5, 0.8, sample_rate, 20_000.0);
        assert_eq!(chirp.len(), 24_000);
        let n = chirp.len().next_power_of_two();
        let spectrum = magnitude_spectrum(&chirp, n);
        let level = |hz: f32| spectrum[(hz / sample_rate as f32 * n as f32).round() as usize];
        assert!(level(5000.0) > 20.0 * level(1000.0));
        assert!(level(5000.0) > 20.0 * level(12_000.0));
    }

    fn monitor_stats() -> Arc<Mutex<MonitorStats>> {
        Arc::new(Mutex::new(MonitorStats {
            current_dbfs: -96.0,
            peak_dbfs: -96.0,
            clip_count: 0,
            sample_rate: 48_000,
            recent_mono: Vec::new(),
            rough_fr_hz: Vec::new(),
            rough_fr_db: Vec::new(),
        }))
    }

    #[test]
    fn monitor_ignores_a_dead_channel_and_counts_per_channel_clips() {
        // Stereo interleaved: a 0.5-amplitude square on the left, digital
        // silence on the right. The level is the left channel's, not 6 dB under.
        let stats = monitor_stats();
        let frames: Vec<f32> = (0..1024)
            .flat_map(|i| [if i % 2 == 0 { 0.5 } else { -0.5 }, 0.0])
            .collect();
        update_monitor_stats(&frames, 2, &stats);
        let level = stats.lock().unwrap().current_dbfs;
        assert!((level - 20.0 * 0.5f32.log10()).abs() < 0.1, "level {level}");

        // A clipped left channel next to a quiet live right one still counts.
        let stats = monitor_stats();
        let frames: Vec<f32> = (0..64).flat_map(|_| [1.0f32, 0.01]).collect();
        update_monitor_stats(&frames, 2, &stats);
        assert_eq!(stats.lock().unwrap().clip_count, 64);
    }

    #[test]
    fn stored_device_selection_follows_the_name_not_the_position() {
        let device = |index, name: &str| AudioDeviceInfo {
            index,
            name: name.to_string(),
            is_input: true,
            channels: 2,
            default_sample_rate: 48_000,
        };
        // "Mic" used to be index 1; a new device now sits there.
        let devices = vec![
            device(0, "Speakers"),
            device(1, "USB Dongle"),
            device(2, "Mic"),
        ];
        assert_eq!(
            resolve_selected_index(&devices, Some(1), Some("Mic")),
            Some(2)
        );
        // Gone entirely: use the default, not whatever now holds index 1.
        assert_eq!(
            resolve_selected_index(&devices, Some(1), Some("Headset")),
            None
        );
        // Two identical names: the stored index breaks the tie.
        let twins = vec![device(3, "Mic"), device(5, "Mic")];
        assert_eq!(
            resolve_selected_index(&twins, Some(5), Some("Mic")),
            Some(5)
        );
        // Selections saved before names existed still resolve by index.
        assert_eq!(resolve_selected_index(&devices, Some(2), None), Some(2));
        assert_eq!(resolve_selected_index(&devices, Some(9), None), None);
    }

    #[test]
    fn sweep_band_is_clamped_without_panicking() {
        // 44.1/48 kHz keep the usual 20 kHz ceiling; a 16 kHz link cannot.
        assert_eq!(max_excitation_hz(44_100, 48_000), 20_000.0);
        assert_eq!(max_excitation_hz(48_000, 16_000), 7_600.0);
        assert_eq!(clamp_sweep_band(20.0, 20_000.0, 20_000.0), (20.0, 20_000.0));
        assert_eq!(clamp_sweep_band(20.0, 20_000.0, 7_600.0), (20.0, 7_600.0));
        // A start above the ceiling used to panic inside f32::clamp.
        let (start, end) = clamp_sweep_band(25_000.0, 20_000.0, 20_000.0);
        assert!(start < end && end <= 20_000.0);
        let (start, end) = clamp_sweep_band(f32::NAN, f32::NAN, 20_000.0);
        assert!(start < end);
    }

    #[test]
    fn rough_fr_of_pink_noise_reads_flat() {
        // Pink noise through a flat path should draw a flat line; before the
        // tilt correction it sloped ~30 dB across the band.
        let sample_rate = 48_000u32;
        let grid = logspace(20.0, 20_000.0, 48);
        let mut state = PinkNoiseState::new(1.0);
        let blocks = 60;
        let mut averaged = vec![0.0f32; grid.len()];
        for _ in 0..blocks {
            let samples: Vec<f32> = (0..8192).map(|_| state.next_sample()).collect();
            let rough = compute_monitor_rough_fr_db(&samples, sample_rate, &grid);
            for (acc, value) in averaged.iter_mut().zip(rough) {
                *acc += value / blocks as f32;
            }
        }
        // Skip the lowest bins, where an 8192-point FFT has too few bins per
        // grid point to average out.
        let at = |hz: f32| {
            let idx = grid.iter().position(|f| *f >= hz).unwrap();
            averaged[idx]
        };
        let low = at(200.0);
        let mid = at(1000.0);
        let high = at(10_000.0);
        assert!(
            (low - mid).abs() < 3.0 && (high - mid).abs() < 3.0,
            "expected a flat line, got 200 Hz {low:.1}, 1 kHz {mid:.1}, 10 kHz {high:.1}"
        );
    }

    #[test]
    fn resample_cubic_safe_on_duplicated_values() {
        // Cubic spline divide-by-zero guard: all-same input should not panic
        let input = vec![0.5f32; 32];
        let output = resample_cubic(&input, 44100, 48000);
        assert!(!output.is_empty());
        assert!(output.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn compute_thd_pure_sine_low_distortion() {
        let sample_rate = 48000u32;
        let freq = 1000.0f32;
        let len = 4096usize;
        let signal: Vec<f32> = (0..len)
            .map(|i| (2.0 * PI * freq * i as f32 / sample_rate as f32).sin())
            .collect();
        let thd = compute_thd(&signal, freq, sample_rate, 5);
        // A pure sine should have very low THD (< 5%)
        assert!(thd < 0.05, "pure sine THD {thd:.4} should be < 0.05");
    }

    #[test]
    fn dead_channel_falls_back_to_live_capture() {
        // "Stereo" mic that only feeds channel 0.
        let captured = vec![vec![0.5, -0.5, 0.25], vec![0.0, 0.0, 0.0]];
        let right = channel_or_mix(&captured, 1);
        assert_eq!(right, vec![0.5, -0.5, 0.25]);
        assert_eq!(channel_or_mix(&captured, 0), vec![0.5, -0.5, 0.25]);
        // A real stereo capture is untouched.
        let stereo = vec![vec![0.5, 0.5], vec![0.1, 0.2]];
        assert_eq!(channel_or_mix(&stereo, 1), vec![0.1, 0.2]);
    }

    #[test]
    fn channel_raw_never_substitutes_a_silent_channel() {
        // The crosstalk case: driven channel loud, leak channel digital silence.
        // channel_or_mix would hand back the driven signal, so the leak path
        // must not use it.
        let captured = vec![vec![0.8, -0.8, 0.8], vec![0.0, 0.0, 0.0]];
        assert_eq!(channel_raw(&captured, 1), vec![0.0, 0.0, 0.0]);
        assert_eq!(channel_raw(&captured, 0), vec![0.8, -0.8, 0.8]);
        // Out-of-range asks yield nothing rather than another channel's data.
        assert!(channel_raw(&captured, 5).is_empty());
    }

    #[test]
    fn silent_leak_channel_reads_as_deep_isolation_not_zero_db() {
        // Regression guard for the crosstalk metric itself: a perfectly
        // isolated leak channel must report a large negative dB, never ~0.
        let captured = vec![vec![0.8, -0.8, 0.8], vec![0.0, 0.0, 0.0]];
        let primary_rms = rms(&channel_raw(&captured, 0));
        let leak_rms = rms(&channel_raw(&captured, 1));
        let crosstalk_db = 20.0 * (leak_rms.max(1e-12) / primary_rms.max(1e-12)).log10();
        assert!(
            crosstalk_db < -100.0,
            "silent leak should read as deep isolation, got {crosstalk_db:.2} dB"
        );

        // And the old channel_or_mix path is exactly what that guards against.
        let substituted = rms(&channel_or_mix(&captured, 1));
        assert!((substituted - primary_rms).abs() < 1e-6);
    }

    #[test]
    fn sanitize_output_name_strips_path_separators() {
        // Separators are what make traversal work; with none left the name can
        // only ever resolve inside the export dir.
        let cleaned = sanitize_output_name("../../etc/passwd");
        assert!(
            !cleaned.contains('/') && !cleaned.contains('\\'),
            "traversal survived sanitizing: {cleaned}"
        );
        assert_eq!(sanitize_output_name("anc"), "anc");
        // A normal export timestamp survives unchanged, so plot and TXT tags match.
        assert_eq!(
            sanitize_output_name("2026-09-03T12-30-45"),
            "2026-09-03T12-30-45"
        );
    }
}
