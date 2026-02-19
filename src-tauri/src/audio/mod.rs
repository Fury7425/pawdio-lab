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
use rand::Rng;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub output_device_index: Option<usize>,
    pub input_device_index: Option<usize>,
    pub output_sample_rate: u32,
    pub input_sample_rate: u32,
    pub duration_secs: f32,
    pub chunk_size: u32,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            output_device_index: None,
            input_device_index: None,
            output_sample_rate: 44_100,
            input_sample_rate: 44_100,
            duration_secs: 0.5,
            chunk_size: 1024,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TestSignalKind {
    Sine,
    Impulse,
    PinkNoise,
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
}

impl Default for LatencyTestRequest {
    fn default() -> Self {
        Self {
            signal: TestSignalKind::Impulse,
            frequency_hz: 1000.0,
            duration_secs: 0.5,
            amplitude: 0.85,
            repeats: 5,
            record_margin_secs: 1.0,
            output_dir: None,
            save_per_sound_plot: true,
            save_overall_bar_chart: true,
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
        }
    }
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
pub struct IsolationRequest {
    pub noise_duration_secs: f32,
    pub amplitude: f32,
}

impl Default for IsolationRequest {
    fn default() -> Self {
        Self {
            noise_duration_secs: 2.0,
            amplitude: 0.4,
        }
    }
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
    #[error("latency test cancelled")]
    Cancelled,
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
        self.settings = settings;
    }

    pub fn list_devices(&self) -> Result<DeviceInventory, AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let input_entries = enumerate_input_devices(&host)?;
        let output_infos: Vec<AudioDeviceInfo> =
            output_entries.iter().map(|(_, info)| info.clone()).collect();
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

    pub fn run_latency_test(
        settings: AudioSettings,
        request: LatencyTestRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<LatencyTestReport, AudioError> {
        let runtime = AudioRuntime::new(settings)?;
        let repeats = request.repeats.clamp(1, 128);
        let duration = request.duration_secs.clamp(0.03, 12.0);
        let amplitude = request.amplitude.clamp(0.01, 1.0);
        let margin = request.record_margin_secs.clamp(0.1, 6.0);
        let (preset_key, preset_name) = latency_preset_identity(request.signal, request.frequency_hz);

        let mut measurements = Vec::with_capacity(repeats as usize);
        let mut first_recorded: Option<Vec<f32>> = None;
        let mut first_reference: Option<Vec<f32>> = None;
        for iteration in 1..=repeats {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let signal = generate_signal(
                request.signal,
                request.frequency_hz.max(20.0),
                duration,
                amplitude,
                runtime.output_rate,
            );
            let recorded =
                runtime.play_and_record_mono(signal.clone(), OutputRouting::Both, duration + margin)?;
            let reference = if runtime.input_rate != runtime.output_rate {
                resample_linear(&signal, runtime.output_rate, runtime.input_rate)
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

        let valid: Vec<f32> = measurements.iter().filter_map(|item| item.delay_ms).collect();
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

        let output_dir = resolve_output_dir(&request.output_dir);
        if request.save_per_sound_plot {
            if let (Some(rec), Some(reference), Some(avg_delay)) =
                (first_recorded.as_ref(), first_reference.as_ref(), report.average_delay_ms)
            {
                if let Ok(path) = latency_plot_path(&output_dir, &preset_key) {
                    if save_latency_plot(
                        &path,
                        rec,
                        reference,
                        avg_delay,
                        runtime.input_rate,
                        &format!("{preset_name} avg {avg_delay:.1} ms"),
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
                let bars = vec![(preset_name.clone(), valid.clone())];
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

        let _ = app.emit("latency-complete", report.clone());
        Ok(report)
    }

    pub fn export_latency_report(
        request: &LatencyTestRequest,
        report: &LatencyTestReport,
    ) -> Result<PathBuf, AudioError> {
        let output_dir = resolve_output_dir(&request.output_dir);
        ensure_output_dir(&output_dir)?;
        let ts = timestamp_filename();
        let path = output_dir.join(format!("latency_report_{ts}.txt"));
        let text = build_latency_text_report(request, report);
        write_text_file(&path, &text)?;
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
        let input_device = select_device(&host, &input_entries, settings.input_device_index, true)?;
        let (input_config, input_format) =
            choose_input_config(&input_device, settings.input_sample_rate)?;
        let channels = input_config.channels as usize;

        let stats = Arc::new(Mutex::new(MonitorStats {
            current_dbfs: -96.0,
            peak_dbfs: -96.0,
            clip_count: 0,
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

            if let Ok(state) = stats.lock() {
                let _ = app.emit(
                    "input-level",
                    InputLevelEvent {
                        current_dbfs: state.current_dbfs,
                        peak_dbfs: state.peak_dbfs,
                        clip_count: state.clip_count,
                    },
                );
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        drop(stream);
        Ok(())
    }

    pub fn run_pink_noise(settings: AudioSettings, cancel: Arc<AtomicBool>) -> Result<(), AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let output_device =
            select_device(&host, &output_entries, settings.output_device_index, false)?;
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

        drop(stream);
        Ok(())
    }

    pub fn run_sweep_fr_test(
        settings: AudioSettings,
        mut request: SweepFrRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings)?;
        request.f0 = request.f0.max(20.0);
        request.f1 = request.f1.clamp(request.f0 + 1.0, 20_000.0);
        request.duration_secs = request.duration_secs.clamp(0.5, 20.0);
        request.amplitude = request.amplitude.clamp(0.05, 1.0);
        request.repeats = request.repeats.clamp(1, 16);

        let grid = logspace(request.f0, request.f1, 200);
        let mut mags_l: Vec<Vec<f32>> = Vec::new();
        let mut mags_r: Vec<Vec<f32>> = Vec::new();
        let mut delays_l: Vec<Option<f32>> = Vec::new();
        let mut delays_r: Vec<Option<f32>> = Vec::new();

        for i in 1..=request.repeats {
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let chirp = generate_log_chirp(
                request.f0,
                request.f1,
                request.duration_secs,
                request.amplitude,
                runtime.output_rate,
            );
            let ref_signal = if runtime.input_rate != runtime.output_rate {
                resample_linear(&chirp, runtime.output_rate, runtime.input_rate)
            } else {
                chirp.clone()
            };

            let (rec_l, rec_r) = if request.mono_mode {
                let captured_l = runtime.play_and_record_channels(
                    chirp.clone(),
                    OutputRouting::LeftOnly,
                    request.duration_secs + 0.5,
                )?;
                let captured_r = runtime.play_and_record_channels(
                    chirp.clone(),
                    OutputRouting::RightOnly,
                    request.duration_secs + 0.5,
                )?;
                let left = channel_or_mix(&captured_l, 0);
                let right = if captured_r.len() > 1 {
                    channel_or_mix(&captured_r, 1)
                } else {
                    channel_or_mix(&captured_r, 0)
                };
                (left, right)
            } else {
                let captured = runtime.play_and_record_channels(
                    chirp.clone(),
                    OutputRouting::Both,
                    request.duration_secs + 0.5,
                )?;
                let left = channel_or_mix(&captured, 0);
                let right = if captured.len() > 1 {
                    channel_or_mix(&captured, 1)
                } else {
                    left.clone()
                };
                (left, right)
            };

            let delay_l = find_delay_ms(&rec_l, &ref_signal, runtime.input_rate);
            let delay_r = find_delay_ms(&rec_r, &ref_signal, runtime.input_rate);
            delays_l.push(delay_l);
            delays_r.push(delay_r);

            let aligned_l = align_to_reference(&rec_l, ref_signal.len(), delay_l, runtime.input_rate);
            let aligned_r = align_to_reference(&rec_r, ref_signal.len(), delay_r, runtime.input_rate);
            let mag_db_l = frequency_response_curve(&aligned_l, &ref_signal, runtime.input_rate, &grid);
            let mag_db_r = frequency_response_curve(&aligned_r, &ref_signal, runtime.input_rate, &grid);
            mags_l.push(mag_db_l);
            mags_r.push(mag_db_r);

            let _ = app.emit(
                "test-progress",
                TestProgressEvent {
                    test: "sweep_fr".to_string(),
                    current: i,
                    total: request.repeats,
                    value: delay_l,
                    message: if request.mono_mode {
                        format!("mono sweep {i}/{}", request.repeats)
                    } else {
                        format!("sweep {i}/{}", request.repeats)
                    },
                },
            );
        }

        if mags_l.is_empty() {
            return Err(AudioError::Cancelled);
        }

        let left_avg = average_curves(&mags_l);
        let right_avg = average_curves(&mags_r);
        let mut all_curves = mags_l.clone();
        all_curves.extend(mags_r.clone());
        let avg_all = average_curves(&all_curves);
        let avg_delay_l = average_option(&delays_l);
        let avg_delay_r = average_option(&delays_r);

        Ok(TestResultPayload {
            test: "sweep_fr".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "f0": request.f0,
                "f1": request.f1,
                "duration": request.duration_secs,
                "repeats": request.repeats,
                "mono_mode": request.mono_mode,
                "save_plots": request.save_plots,
                "save_squiglink": request.save_squiglink,
                "output_dir": request.output_dir.clone()
            }),
            metrics: json!({
                "delay_ms_left": avg_delay_l,
                "delay_ms_right": avg_delay_r
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
            files: {
                let mut files = serde_json::Map::<String, Value>::new();
                let output_dir = resolve_output_dir(&request.output_dir);
                let ts = timestamp_filename();

                if request.save_plots {
                    ensure_output_dir(&output_dir)?;

                    let left_avg_path = output_dir.join(format!("sweep_fr_left_avg_{ts}.png"));
                    save_sweep_single_plot(
                        &left_avg_path,
                        "Left Average Frequency Response",
                        &grid,
                        &left_avg,
                    )?;
                    files.insert(
                        "plot_left_avg".to_string(),
                        Value::String(left_avg_path.display().to_string()),
                    );

                    let left_all_path = output_dir.join(format!("sweep_fr_left_all_{ts}.png"));
                    save_sweep_multi_plot(
                        &left_all_path,
                        "Left All Sweeps Frequency Response",
                        &grid,
                        &mags_l,
                    )?;
                    files.insert(
                        "plot_left_all".to_string(),
                        Value::String(left_all_path.display().to_string()),
                    );

                    let right_avg_path = output_dir.join(format!("sweep_fr_right_avg_{ts}.png"));
                    save_sweep_single_plot(
                        &right_avg_path,
                        "Right Average Frequency Response",
                        &grid,
                        &right_avg,
                    )?;
                    files.insert(
                        "plot_right_avg".to_string(),
                        Value::String(right_avg_path.display().to_string()),
                    );

                    let right_all_path = output_dir.join(format!("sweep_fr_right_all_{ts}.png"));
                    save_sweep_multi_plot(
                        &right_all_path,
                        "Right All Sweeps Frequency Response",
                        &grid,
                        &mags_r,
                    )?;
                    files.insert(
                        "plot_right_all".to_string(),
                        Value::String(right_all_path.display().to_string()),
                    );

                    let all_path = output_dir.join(format!("sweep_fr_all_{ts}.png"));
                    save_sweep_multi_plot(&all_path, "All Sweeps Frequency Response", &grid, &all_curves)?;
                    files.insert(
                        "plot_all".to_string(),
                        Value::String(all_path.display().to_string()),
                    );

                    let lr_avg_path = output_dir.join(format!("sweep_fr_lr_avg_{ts}.png"));
                    save_sweep_lr_avg_plot(&lr_avg_path, &grid, &left_avg, &right_avg)?;
                    files.insert(
                        "plot_lr_avg".to_string(),
                        Value::String(lr_avg_path.display().to_string()),
                    );

                    let avg_all_path = output_dir.join(format!("sweep_fr_avg_all_{ts}.png"));
                    save_sweep_single_plot(
                        &avg_all_path,
                        "Average of All Frequency Response",
                        &grid,
                        &avg_all,
                    )?;
                    files.insert(
                        "plot_avg_all".to_string(),
                        Value::String(avg_all_path.display().to_string()),
                    );
                }

                if request.save_squiglink {
                    ensure_output_dir(&output_dir)?;
                    let squig_files = save_squiglink_files(&output_dir, &ts, &grid, &left_avg, &right_avg, &avg_all)?;
                    for (key, value) in squig_files {
                        files.insert(key, Value::String(value));
                    }
                }

                Value::Object(files)
            },
        })
    }

    pub fn run_thd_test(
        settings: AudioSettings,
        request: ThdRequest,
        cancel: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings)?;
        let tones = if request.tones.is_empty() {
            vec![100.0, 1000.0, 6000.0]
        } else {
            request.tones.clone()
        };
        let tone_duration = request.tone_duration_secs.clamp(0.1, 6.0);
        let amp = request.amplitude.clamp(0.05, 1.0);

        let mut items = Vec::new();
        for (idx, freq) in tones.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let signal = generate_sine(*freq, tone_duration, amp, runtime.output_rate);
            let recorded =
                runtime.play_and_record_mono(signal, OutputRouting::Both, tone_duration + 0.3)?;
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
        let runtime = AudioRuntime::new(settings)?;
        let freq = request.frequency_hz.max(20.0);
        let duration = request.tone_duration_secs.clamp(0.1, 6.0);
        let settle = request.settle_secs.clamp(0.0, 2.0);

        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let signal = generate_sine(freq, duration, 0.8, runtime.output_rate);
        let rec_l = runtime.play_and_record_mono(signal.clone(), OutputRouting::LeftOnly, duration + 0.3)?;
        std::thread::sleep(Duration::from_secs_f32(settle));
        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let rec_r = runtime.play_and_record_mono(signal, OutputRouting::RightOnly, duration + 0.3)?;

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
        let runtime = AudioRuntime::new(settings)?;
        let freq = request.frequency_hz.max(20.0);
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
        let captured = runtime.play_and_record_channels(signal.clone(), routing, duration + 0.3)?;
        let (rec_primary, rec_leak) = if captured.len() > 1 {
            if direction == "RtoL" {
                (channel_or_mix(&captured, 1), channel_or_mix(&captured, 0))
            } else {
                (channel_or_mix(&captured, 0), channel_or_mix(&captured, 1))
            }
        } else {
            std::thread::sleep(Duration::from_secs_f32(settle));
            if cancel.load(Ordering::SeqCst) {
                return Err(AudioError::Cancelled);
            }
            let leak_routing = if direction == "RtoL" {
                OutputRouting::LeftOnly
            } else {
                OutputRouting::RightOnly
            };
            let primary = mixdown_channels(&captured);
            let leak = runtime.play_and_record_mono(signal, leak_routing, duration + 0.3)?;
            (primary, leak)
        };

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

    pub fn run_isolation_test(
        settings: AudioSettings,
        request: IsolationRequest,
        cancel: Arc<AtomicBool>,
    ) -> Result<TestResultPayload, AudioError> {
        let runtime = AudioRuntime::new(settings)?;
        let duration = request.noise_duration_secs.clamp(0.2, 8.0);
        let amp = request.amplitude.clamp(0.05, 1.0);

        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let noise = generate_pink_noise(duration, amp, runtime.output_rate);
        let rec_in = runtime.play_and_record_mono(noise.clone(), OutputRouting::Both, duration + 0.3)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let rec_out = runtime.play_and_record_mono(noise, OutputRouting::Both, duration + 0.3)?;

        let inside_db = dbfs(&rec_in);
        let outside_db = dbfs(&rec_out);
        let delta = inside_db - outside_db;

        Ok(TestResultPayload {
            test: "isolation_inside_out".to_string(),
            timestamp: timestamp_string(),
            params: json!({
                "noise_dur": duration
            }),
            metrics: json!({
                "inside_dBFS": inside_db,
                "outside_dBFS": outside_db,
                "delta_dB": delta
            }),
            data: json!({}),
            files: json!({}),
        })
    }
}

impl AudioRuntime {
    fn new(settings: AudioSettings) -> Result<Self, AudioError> {
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let input_entries = enumerate_input_devices(&host)?;
        let output_device =
            select_device(&host, &output_entries, settings.output_device_index, false)?;
        let input_device = select_device(&host, &input_entries, settings.input_device_index, true)?;
        let (output_config, output_format) =
            choose_output_config(&output_device, settings.output_sample_rate)?;
        let (input_config, input_format) =
            choose_input_config(&input_device, settings.input_sample_rate)?;

        Ok(Self {
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
        if let Ok(config) = device.default_output_config() {
            output_devices.push((
                device.clone(),
                AudioDeviceInfo {
                    index: host_index,
                    name: device.name()?,
                    is_input: false,
                    channels: config.channels(),
                    default_sample_rate: config.sample_rate().0,
                },
            ));
        }
    }
    Ok(output_devices)
}

fn enumerate_input_devices(host: &Host) -> Result<Vec<(Device, AudioDeviceInfo)>, AudioError> {
    let mut input_devices = Vec::new();
    for (host_index, device) in host.devices()?.enumerate() {
        if let Ok(config) = device.default_input_config() {
            input_devices.push((
                device.clone(),
                AudioDeviceInfo {
                    index: host_index,
                    name: device.name()?,
                    is_input: true,
                    channels: config.channels(),
                    default_sample_rate: config.sample_rate().0,
                },
            ));
        }
    }
    Ok(input_devices)
}

fn default_index_for_output(host: &Host, outputs: &[AudioDeviceInfo]) -> Option<usize> {
    let name = host.default_output_device()?.name().ok()?;
    outputs.iter().find(|item| item.name == name).map(|item| item.index)
}

fn default_index_for_input(host: &Host, inputs: &[AudioDeviceInfo]) -> Option<usize> {
    let name = host.default_input_device()?.name().ok()?;
    inputs.iter().find(|item| item.name == name).map(|item| item.index)
}

fn select_device(
    host: &Host,
    entries: &[(Device, AudioDeviceInfo)],
    selected_index: Option<usize>,
    is_input: bool,
) -> Result<Device, AudioError> {
    if let Some(index) = selected_index {
        if let Some((device, _)) = entries.iter().find(|(_, info)| info.index == index) {
            return Ok(device.clone());
        }
        // Backward-compat fallback for previously persisted compact indices.
        if let Some((device, _)) = entries.get(index) {
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

fn choose_output_config(
    device: &Device,
    preferred_rate: u32,
) -> Result<(StreamConfig, SampleFormat), AudioError> {
    let mut fallback = None;
    for range in device.supported_output_configs()? {
        let format = range.sample_format();
        let min_rate = range.min_sample_rate().0;
        let max_rate = range.max_sample_rate().0;
        if preferred_rate >= min_rate && preferred_rate <= max_rate {
            let selected = range.with_sample_rate(SampleRate(preferred_rate));
            return Ok((selected.config(), format));
        }
        if fallback.is_none() {
            let selected = range.with_max_sample_rate();
            fallback = Some((selected.config(), format));
        }
    }
    if let Some(config) = fallback {
        return Ok(config);
    }
    let default = device.default_output_config()?;
    Ok((default.config(), default.sample_format()))
}

fn choose_input_config(
    device: &Device,
    preferred_rate: u32,
) -> Result<(StreamConfig, SampleFormat), AudioError> {
    let mut fallback = None;
    for range in device.supported_input_configs()? {
        let format = range.sample_format();
        let min_rate = range.min_sample_rate().0;
        let max_rate = range.max_sample_rate().0;
        if preferred_rate >= min_rate && preferred_rate <= max_rate {
            let selected = range.with_sample_rate(SampleRate(preferred_rate));
            return Ok((selected.config(), format));
        }
        if fallback.is_none() {
            let selected = range.with_max_sample_rate();
            fallback = Some((selected.config(), format));
        }
    }
    if let Some(config) = fallback {
        return Ok(config);
    }
    let default = device.default_input_config()?;
    Ok((default.config(), default.sample_format()))
}

fn generate_signal(
    kind: TestSignalKind,
    frequency_hz: f32,
    duration_secs: f32,
    amplitude: f32,
    sample_rate: u32,
) -> Vec<f32> {
    match kind {
        TestSignalKind::Sine => generate_sine(frequency_hz, duration_secs, amplitude, sample_rate),
        TestSignalKind::Impulse => generate_impulse(duration_secs, amplitude, sample_rate),
        TestSignalKind::PinkNoise => generate_pink_noise(duration_secs, amplitude, sample_rate),
    }
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

fn generate_impulse(duration_secs: f32, amplitude: f32, sample_rate: u32) -> Vec<f32> {
    let total_samples = ((duration_secs * sample_rate as f32).round() as usize).max(256);
    let mut signal = vec![0.0; total_samples];
    let impulse_len = 1usize;
    let start = ((sample_rate as f32 * 0.01).round() as usize)
        .min(total_samples.saturating_sub(impulse_len));
    for sample in signal.iter_mut().skip(start).take(impulse_len) {
        *sample = amplitude;
    }
    signal
}

fn generate_pink_noise(duration_secs: f32, amplitude: f32, sample_rate: u32) -> Vec<f32> {
    let total_samples = ((duration_secs * sample_rate as f32).round() as usize).max(1);
    let mut rng = rand::thread_rng();
    let mut b0 = 0.0f32;
    let mut b1 = 0.0f32;
    let mut b2 = 0.0f32;
    let mut b3 = 0.0f32;
    let mut b4 = 0.0f32;
    let mut b5 = 0.0f32;
    let mut b6 = 0.0f32;
    let mut pink = Vec::with_capacity(total_samples);

    for _ in 0..total_samples {
        let x = rng.gen_range(-1.0f32..1.0f32);
        b0 = 0.99886 * b0 + x * 0.055_517_9;
        b1 = 0.99332 * b1 + x * 0.075_075_9;
        b2 = 0.96900 * b2 + x * 0.153_852_0;
        b3 = 0.86650 * b3 + x * 0.310_485_6;
        b4 = 0.55000 * b4 + x * 0.532_952_2;
        b5 = -0.7616 * b5 - x * 0.016_898_0;
        let y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
        b6 = x * 0.115_926;
        pink.push(y);
    }

    let peak = pink
        .iter()
        .copied()
        .fold(0.0f32, |acc, val| acc.max(val.abs()))
        .max(1e-9);
    pink.into_iter().map(|sample| (sample / peak) * amplitude).collect()
}

fn generate_log_chirp(f0: f32, f1: f32, duration_secs: f32, amplitude: f32, sample_rate: u32) -> Vec<f32> {
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
    if curves.is_empty() {
        return Vec::new();
    }
    let len = curves[0].len();
    if len == 0 {
        return Vec::new();
    }

    let mut acc = vec![0.0f32; len];
    for curve in curves {
        for (idx, value) in curve.iter().enumerate().take(len) {
            acc[idx] += *value;
        }
    }
    for value in &mut acc {
        *value /= curves.len() as f32;
    }
    acc
}

fn mixdown_channels(channels: &[Vec<f32>]) -> Vec<f32> {
    if channels.is_empty() {
        return Vec::new();
    }
    let frames = channels
        .iter()
        .map(|channel| channel.len())
        .min()
        .unwrap_or(0);
    if frames == 0 {
        return Vec::new();
    }

    let mut mono = Vec::with_capacity(frames);
    for idx in 0..frames {
        let mut sum = 0.0f32;
        for channel in channels {
            sum += channel[idx];
        }
        mono.push(sum / channels.len() as f32);
    }
    mono
}

fn channel_or_mix(channels: &[Vec<f32>], channel: usize) -> Vec<f32> {
    if channels.is_empty() {
        return Vec::new();
    }
    if channel < channels.len() && !channels[channel].is_empty() {
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

    candidate.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
    })
}

fn ensure_output_dir(path: &Path) -> Result<(), AudioError> {
    fs::create_dir_all(path).map_err(|err| {
        AudioError::FileExport(format!("failed to create output dir {}: {err}", path.display()))
    })
}

fn write_text_file(path: &Path, content: &str) -> Result<(), AudioError> {
    let mut file = File::create(path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", path.display()))
    })?;
    file.write_all(content.as_bytes()).map_err(|err| {
        AudioError::FileExport(format!("failed to write {}: {err}", path.display()))
    })
}

fn timestamp_filename() -> String {
    timestamp_string()
        .replace('-', "")
        .replace(' ', "_")
        .replace(':', "")
}

fn latency_preset_identity(signal: TestSignalKind, frequency_hz: f32) -> (String, String) {
    match signal {
        TestSignalKind::Impulse => ("impulse".to_string(), "Click (Impulse)".to_string()),
        TestSignalKind::PinkNoise => ("pink_noise".to_string(), "Pink Noise".to_string()),
        TestSignalKind::Sine => {
            let f = frequency_hz;
            if (f - 1000.0).abs() <= 20.0 {
                ("beep_1k".to_string(), "1 kHz Beep".to_string())
            } else if (f - 2000.0).abs() <= 20.0 {
                ("beep_2k".to_string(), "2 kHz Beep".to_string())
            } else if (f - 5000.0).abs() <= 50.0 {
                ("beep_5k".to_string(), "5 kHz Beep".to_string())
            } else if (f - 200.0).abs() <= 5.0 {
                ("beep_200".to_string(), "200 Hz Beep".to_string())
            } else {
                ("sine_custom".to_string(), format!("Sine {f:.0} Hz"))
            }
        }
    }
}

fn latency_plot_path(output_dir: &Path, preset_key: &str) -> Result<PathBuf, AudioError> {
    ensure_output_dir(output_dir)?;
    Ok(output_dir.join(format!(
        "{preset_key}_plot_{}.png",
        timestamp_filename()
    )))
}

fn overall_bar_path(output_dir: &Path) -> Result<PathBuf, AudioError> {
    ensure_output_dir(output_dir)?;
    Ok(output_dir.join(format!("overall_bar_{}.png", timestamp_filename())))
}

fn build_latency_text_report(request: &LatencyTestRequest, report: &LatencyTestReport) -> String {
    let delays: Vec<f32> = report.measurements.iter().filter_map(|m| m.delay_ms).collect();
    let overall_avg = report.average_delay_ms.unwrap_or_else(|| mean(&delays));
    let overall_std = report
        .std_dev_ms
        .unwrap_or_else(|| standard_deviation(&delays, overall_avg));
    let signal_name = latency_preset_identity(request.signal, request.frequency_hz).1;

    let mut lines = vec![
        "============================================================".to_string(),
        "HEADPHONE DELAY TEST REPORT".to_string(),
        "============================================================".to_string(),
        format!("Test Date: {}", report.timestamp_utc),
        format!("Overall Tests Per Sound Type: {}", request.repeats),
        format!("Output Sample Rate: {} Hz", report.sample_rate),
        format!("Input Sample Rate: {} Hz", report.input_sample_rate),
        format!(
            "Default Test Signal Buffer Duration: {:.3} seconds",
            request.duration_secs
        ),
        "Calibration Offset Applied: 0.0000 ms".to_string(),
        "".to_string(),
        "".to_string(),
        "==================== OVERALL AVERAGE CALIBRATED DELAY (ALL SOUND TYPES) ====================".to_string(),
        format!("Overall Average Calibrated Delay: {overall_avg:.4} ms"),
        format!("Overall Standard Deviation: {overall_std:.4} ms"),
        format!("Total Successful Tests: {}", delays.len()),
        "============================================================".to_string(),
        "".to_string(),
        format!("==================== Results for '{}' ====================", signal_name),
        "Individual test results (Calibrated):".to_string(),
        "------------------------------".to_string(),
    ];

    for measurement in &report.measurements {
        if let Some(value) = measurement.delay_ms {
            lines.push(format!("Test {}: {value:.4} ms", measurement.iteration));
        } else {
            lines.push(format!("Test {}: failed", measurement.iteration));
        }
    }

    lines.extend([
        "".to_string(),
        "STATISTICAL ANALYSIS:".to_string(),
        "------------------------------".to_string(),
        format!("Average calibrated delay: {overall_avg:.4} ms"),
        format!("Standard deviation: {overall_std:.4} ms"),
        if delays.is_empty() {
            "No successful runs".to_string()
        } else {
            let min = delays.iter().copied().fold(f32::INFINITY, f32::min);
            let max = delays.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            format!(
                "Minimum calibrated delay: {min:.4} ms\nMaximum calibrated delay: {max:.4} ms\nRange: {:.4} ms",
                max - min
            )
        },
        "".to_string(),
        "============================================================".to_string(),
        "REPORT END".to_string(),
        "============================================================".to_string(),
    ]);

    lines.join("\n")
}

fn y_bounds(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (-1.0, 1.0);
    }
    let min = samples.iter().copied().fold(f32::INFINITY, f32::min);
    let max = samples
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    if (max - min).abs() < 1e-6 {
        (min - 0.5, max + 0.5)
    } else {
        let pad = (max - min) * 0.08;
        (min - pad, max + pad)
    }
}

fn save_latency_plot(
    path: &Path,
    recorded: &[f32],
    reference: &[f32],
    avg_delay_ms: f32,
    sample_rate: u32,
    title: &str,
) -> Result<(), AudioError> {
    let root = BitMapBackend::new(path, (1100, 700)).into_drawing_area();
    root.fill(&RGBColor(16, 20, 30))
        .map_err(|err| AudioError::FileExport(format!("plot background {}: {err}", path.display())))?;
    let areas = root.split_evenly((3, 1));

    {
        let x_end = (reference.len().max(1) as f32 * 1000.0) / sample_rate.max(1) as f32;
        let (y_min, y_max) = y_bounds(reference);
        let mut chart = ChartBuilder::on(&areas[0])
            .margin(10)
            .caption(format!("{title} | Reference"), ("sans-serif", 20).into_font().color(&WHITE))
            .set_label_area_size(LabelAreaPosition::Left, 45)
            .set_label_area_size(LabelAreaPosition::Bottom, 35)
            .build_cartesian_2d(0f32..x_end.max(1.0), y_min..y_max)
            .map_err(|err| AudioError::FileExport(format!("plot reference {}: {err}", path.display())))?;
        chart
            .configure_mesh()
            .x_desc("ms")
            .y_desc("amp")
            .axis_style(WHITE.mix(0.85))
            .label_style(("sans-serif", 12).into_font().color(&WHITE))
            .draw()
            .map_err(|err| AudioError::FileExport(format!("plot mesh {}: {err}", path.display())))?;
        chart
            .draw_series(LineSeries::new(
                reference
                    .iter()
                    .enumerate()
                    .map(|(idx, value)| (idx as f32 * 1000.0 / sample_rate.max(1) as f32, *value)),
                &CYAN,
            ))
            .map_err(|err| AudioError::FileExport(format!("plot line {}: {err}", path.display())))?;
    }

    {
        let x_end = (recorded.len().max(1) as f32 * 1000.0) / sample_rate.max(1) as f32;
        let (y_min, y_max) = y_bounds(recorded);
        let mut chart = ChartBuilder::on(&areas[1])
            .margin(10)
            .caption("Recorded", ("sans-serif", 18).into_font().color(&WHITE))
            .set_label_area_size(LabelAreaPosition::Left, 45)
            .set_label_area_size(LabelAreaPosition::Bottom, 35)
            .build_cartesian_2d(0f32..x_end.max(1.0), y_min..y_max)
            .map_err(|err| AudioError::FileExport(format!("plot recorded {}: {err}", path.display())))?;
        chart
            .configure_mesh()
            .x_desc("ms")
            .y_desc("amp")
            .axis_style(WHITE.mix(0.85))
            .label_style(("sans-serif", 12).into_font().color(&WHITE))
            .draw()
            .map_err(|err| AudioError::FileExport(format!("plot mesh {}: {err}", path.display())))?;
        chart
            .draw_series(LineSeries::new(
                recorded
                    .iter()
                    .enumerate()
                    .map(|(idx, value)| (idx as f32 * 1000.0 / sample_rate.max(1) as f32, *value)),
                &YELLOW,
            ))
            .map_err(|err| AudioError::FileExport(format!("plot line {}: {err}", path.display())))?;
    }

    {
        let mut corr_points = cross_correlation_points(recorded, reference, sample_rate);
        if corr_points.len() > 4000 {
            let step = (corr_points.len() as f32 / 4000.0).ceil() as usize;
            corr_points = corr_points.into_iter().step_by(step.max(1)).collect();
        }
        let ys: Vec<f32> = corr_points.iter().map(|(_, value)| *value).collect();
        let (y_min, y_max) = y_bounds(&ys);
        let x_end = corr_points.last().map(|(x, _)| *x).unwrap_or(1.0);
        let mut chart = ChartBuilder::on(&areas[2])
            .margin(10)
            .caption("Cross-Correlation", ("sans-serif", 18).into_font().color(&WHITE))
            .set_label_area_size(LabelAreaPosition::Left, 45)
            .set_label_area_size(LabelAreaPosition::Bottom, 35)
            .build_cartesian_2d(0f32..x_end.max(1.0), y_min..y_max)
            .map_err(|err| AudioError::FileExport(format!("plot correlation {}: {err}", path.display())))?;
        chart
            .configure_mesh()
            .x_desc("Delay (ms)")
            .y_desc("corr")
            .axis_style(WHITE.mix(0.85))
            .label_style(("sans-serif", 12).into_font().color(&WHITE))
            .draw()
            .map_err(|err| AudioError::FileExport(format!("plot mesh {}: {err}", path.display())))?;
        chart
            .draw_series(LineSeries::new(corr_points.iter().copied(), &GREEN))
            .map_err(|err| AudioError::FileExport(format!("plot line {}: {err}", path.display())))?;
        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(avg_delay_ms, y_min), (avg_delay_ms, y_max)],
                RED.stroke_width(2),
            )))
            .map_err(|err| AudioError::FileExport(format!("plot marker {}: {err}", path.display())))?;
    }

    root.present()
        .map_err(|err| AudioError::FileExport(format!("plot write {}: {err}", path.display())))
}

fn cross_correlation_points(recorded: &[f32], reference: &[f32], sample_rate: u32) -> Vec<(f32, f32)> {
    if recorded.is_empty() || reference.is_empty() || sample_rate == 0 {
        return Vec::new();
    }

    let n = (recorded.len() + reference.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut a = vec![Complex { re: 0.0f32, im: 0.0f32 }; n];
    let mut b = vec![Complex { re: 0.0f32, im: 0.0f32 }; n];
    for (idx, value) in recorded.iter().enumerate() {
        a[idx].re = *value;
    }
    for (idx, value) in reference.iter().enumerate() {
        b[idx].re = *value;
    }
    fft.process(&mut a);
    fft.process(&mut b);
    for (left, right) in a.iter_mut().zip(b.iter()) {
        *left *= right.conj();
    }
    ifft.process(&mut a);

    let max_lag = recorded.len().saturating_sub(1).min(a.len().saturating_sub(1));
    (0..=max_lag)
        .map(|idx| (idx as f32 * 1000.0 / sample_rate as f32, a[idx].re))
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

    let mut y_min = means
        .iter()
        .zip(stds.iter())
        .map(|(m, s)| m - s)
        .fold(f32::INFINITY, f32::min);
    let mut y_max = means
        .iter()
        .zip(stds.iter())
        .map(|(m, s)| m + s)
        .fold(f32::NEG_INFINITY, f32::max);
    y_min = y_min.min(0.0) - 0.5;
    y_max += 0.8;
    if y_max <= y_min {
        y_max = y_min + 1.0;
    }

    let root = BitMapBackend::new(path, (1000, 600)).into_drawing_area();
    root.fill(&RGBColor(16, 20, 30))
        .map_err(|err| AudioError::FileExport(format!("bar background {}: {err}", path.display())))?;

    let x_end = labels.len() as f32;
    let mut chart = ChartBuilder::on(&root)
        .margin(20)
        .caption(
            "Average Delay by Sound Type",
            ("sans-serif", 26).into_font().color(&WHITE),
        )
        .set_label_area_size(LabelAreaPosition::Left, 48)
        .set_label_area_size(LabelAreaPosition::Bottom, 70)
        .build_cartesian_2d(0f32..x_end, y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("bar chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Sound Type")
        .y_desc("Delay (ms)")
        .x_labels(labels.len())
        .x_label_formatter(&|x| {
            let idx = (*x).floor() as usize;
            if idx < labels.len() {
                labels[idx].clone()
            } else {
                String::new()
            }
        })
        .axis_style(WHITE.mix(0.85))
        .label_style(("sans-serif", 12).into_font().color(&WHITE))
        .draw()
        .map_err(|err| AudioError::FileExport(format!("bar mesh {}: {err}", path.display())))?;

    for (idx, (mean_value, std_value)) in means.iter().zip(stds.iter()).enumerate() {
        let left = idx as f32 + 0.15;
        let right = idx as f32 + 0.85;
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [(left, 0.0f32.min(*mean_value)), (right, *mean_value)],
                BLUE.filled(),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar draw {}: {err}", path.display())))?;

        let center = idx as f32 + 0.5;
        chart
            .draw_series(std::iter::once(PathElement::new(
                vec![(center, mean_value - std_value), (center, mean_value + std_value)],
                WHITE.stroke_width(2),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar err {}: {err}", path.display())))?;

        chart
            .draw_series(std::iter::once(Text::new(
                format!("{mean_value:.1}+-{std_value:.1}"),
                (center, mean_value + std_value + 0.05),
                ("sans-serif", 14).into_font().color(&WHITE),
            )))
            .map_err(|err| AudioError::FileExport(format!("bar label {}: {err}", path.display())))?;
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

    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let (y_min, y_max) = sweep_y_bounds(curves);

    let root = BitMapBackend::new(path, (900, 500)).into_drawing_area();
    root.fill(&RGBColor(16, 20, 30))
        .map_err(|err| AudioError::FileExport(format!("sweep background {}: {err}", path.display())))?;

    let mut chart = ChartBuilder::on(&root)
        .margin(18)
        .caption(title, ("sans-serif", 22).into_font().color(&WHITE))
        .set_label_area_size(LabelAreaPosition::Left, 52)
        .set_label_area_size(LabelAreaPosition::Bottom, 46)
        .build_cartesian_2d((x_min..x_max).log_scale(), y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("sweep chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("Relative Level (dB)")
        .axis_style(WHITE.mix(0.85))
        .label_style(("sans-serif", 12).into_font().color(&WHITE))
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep mesh {}: {err}", path.display())))?;

    for (idx, curve) in curves.iter().enumerate() {
        let color = Palette99::pick(idx).mix(if curves.len() > 1 { 0.45 } else { 0.95 });
        chart
            .draw_series(LineSeries::new(
                freqs
                    .iter()
                    .zip(curve.iter())
                    .map(|(x, y)| (*x, *y)),
                color.stroke_width(if curves.len() > 1 { 1 } else { 2 }),
            ))
            .map_err(|err| AudioError::FileExport(format!("sweep line {}: {err}", path.display())))?;
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
    let x_min = freqs
        .iter()
        .copied()
        .filter(|f| *f > 0.0)
        .fold(f32::INFINITY, f32::min);
    let x_max = freqs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let (y_min, y_max) = y_bounds(&left.iter().chain(right.iter()).copied().collect::<Vec<f32>>());

    let root = BitMapBackend::new(path, (900, 500)).into_drawing_area();
    root.fill(&RGBColor(16, 20, 30))
        .map_err(|err| AudioError::FileExport(format!("sweep background {}: {err}", path.display())))?;

    let mut chart = ChartBuilder::on(&root)
        .margin(18)
        .caption(
            "Left/Right Average Frequency Response",
            ("sans-serif", 22).into_font().color(&WHITE),
        )
        .set_label_area_size(LabelAreaPosition::Left, 52)
        .set_label_area_size(LabelAreaPosition::Bottom, 46)
        .build_cartesian_2d((x_min..x_max).log_scale(), y_min..y_max)
        .map_err(|err| AudioError::FileExport(format!("sweep chart {}: {err}", path.display())))?;

    chart
        .configure_mesh()
        .x_desc("Frequency (Hz)")
        .y_desc("Relative Level (dB)")
        .axis_style(WHITE.mix(0.85))
        .label_style(("sans-serif", 12).into_font().color(&WHITE))
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep mesh {}: {err}", path.display())))?;

    chart
        .draw_series(LineSeries::new(
            freqs.iter().zip(left.iter()).map(|(x, y)| (*x, *y)),
            CYAN.stroke_width(2),
        ))
        .map_err(|err| AudioError::FileExport(format!("sweep left {}: {err}", path.display())))?
        .label("Left")
        .legend(|(x, y)| PathElement::new(vec![(x, y), (x + 20, y)], CYAN.stroke_width(2)));

    chart
        .draw_series(LineSeries::new(
            freqs.iter().zip(right.iter()).map(|(x, y)| (*x, *y)),
            YELLOW.stroke_width(2),
        ))
        .map_err(|err| AudioError::FileExport(format!("sweep right {}: {err}", path.display())))?
        .label("Right")
        .legend(|(x, y)| PathElement::new(vec![(x, y), (x + 20, y)], YELLOW.stroke_width(2)));

    chart
        .configure_series_labels()
        .border_style(WHITE.mix(0.7))
        .background_style(BLACK.mix(0.2))
        .draw()
        .map_err(|err| AudioError::FileExport(format!("sweep legend {}: {err}", path.display())))?;

    root.present()
        .map_err(|err| AudioError::FileExport(format!("sweep write {}: {err}", path.display())))
}

fn save_squiglink_files(
    output_dir: &Path,
    timestamp: &str,
    freqs: &[f32],
    left_db: &[f32],
    right_db: &[f32],
    avg_db: &[f32],
) -> Result<Vec<(String, String)>, AudioError> {
    let left_path = output_dir.join(format!("squiglink_left_{timestamp}.txt"));
    let right_path = output_dir.join(format!("squiglink_right_{timestamp}.txt"));
    let avg_path = output_dir.join(format!("squiglink_avg_{timestamp}.txt"));
    let both_path = output_dir.join(format!("squiglink_both_{timestamp}.txt"));

    let mut left = File::create(&left_path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", left_path.display()))
    })?;
    writeln!(left, "# PawdioLab Frequency Response - Left Channel")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", left_path.display())))?;
    writeln!(left, "# Frequency(Hz)\tAmplitude(dB)")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", left_path.display())))?;
    for (freq, amp) in freqs.iter().zip(left_db.iter()) {
        writeln!(left, "{freq:.2}\t{amp:.3}")
            .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", left_path.display())))?;
    }

    let mut right = File::create(&right_path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", right_path.display()))
    })?;
    writeln!(right, "# PawdioLab Frequency Response - Right Channel")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", right_path.display())))?;
    writeln!(right, "# Frequency(Hz)\tAmplitude(dB)")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", right_path.display())))?;
    for (freq, amp) in freqs.iter().zip(right_db.iter()) {
        writeln!(right, "{freq:.2}\t{amp:.3}")
            .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", right_path.display())))?;
    }

    let mut avg = File::create(&avg_path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", avg_path.display()))
    })?;
    writeln!(avg, "# PawdioLab Frequency Response - Average (L+R)")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", avg_path.display())))?;
    writeln!(avg, "# Frequency(Hz)\tAmplitude(dB)")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", avg_path.display())))?;
    for (freq, amp) in freqs.iter().zip(avg_db.iter()) {
        writeln!(avg, "{freq:.2}\t{amp:.3}")
            .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", avg_path.display())))?;
    }

    let mut both = File::create(&both_path).map_err(|err| {
        AudioError::FileExport(format!("failed to create {}: {err}", both_path.display()))
    })?;
    writeln!(both, "# PawdioLab Frequency Response - Both Channels")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", both_path.display())))?;
    writeln!(both, "# Frequency(Hz)\tLeft(dB)\tRight(dB)")
        .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", both_path.display())))?;
    for ((freq, left), right) in freqs.iter().zip(left_db.iter()).zip(right_db.iter()) {
        writeln!(both, "{freq:.2}\t{left:.3}\t{right:.3}")
            .map_err(|err| AudioError::FileExport(format!("failed to write {}: {err}", both_path.display())))?;
    }

    Ok(vec![
        ("squiglink_left".to_string(), left_path.display().to_string()),
        ("squiglink_right".to_string(), right_path.display().to_string()),
        ("squiglink_avg".to_string(), avg_path.display().to_string()),
        ("squiglink_both".to_string(), both_path.display().to_string()),
    ])
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

    format!(
        "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}"
    )
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

fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == 0 || dst_rate == 0 {
        return Vec::new();
    }
    if src_rate == dst_rate {
        return input.to_vec();
    }

    let output_len = ((input.len() as f64) * (dst_rate as f64) / (src_rate as f64)).round() as usize;
    let output_len = output_len.max(1);
    let ratio = src_rate as f64 / dst_rate as f64;

    let mut output = vec![0.0f32; output_len];
    for (idx, sample) in output.iter_mut().enumerate() {
        let source_pos = idx as f64 * ratio;
        let base = source_pos.floor() as usize;
        let frac = (source_pos - base as f64) as f32;
        let a = input[base.min(input.len() - 1)];
        let b = input[(base + 1).min(input.len() - 1)];
        *sample = a + (b - a) * frac;
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
    let mut buffer = vec![Complex { re: 0.0f32, im: 0.0f32 }; n];

    for (idx, value) in signal.iter().enumerate().take(n) {
        buffer[idx].re = *value;
    }

    fft.process(&mut buffer);

    let half = n / 2 + 1;
    buffer
        .into_iter()
        .take(half)
        .map(|c| (c.re * c.re + c.im * c.im).sqrt())
        .collect()
}

fn compute_thd(samples: &[f32], fundamental_hz: f32, sample_rate: u32, harmonics: usize) -> f32 {
    if samples.is_empty() || fundamental_hz <= 0.0 || sample_rate == 0 {
        return 0.0;
    }

    let n = samples.len().next_power_of_two().max(1024);
    let mut windowed = vec![0.0f32; samples.len()];
    let denom = (samples.len().saturating_sub(1)).max(1) as f32;
    for (idx, sample) in samples.iter().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * PI * idx as f32 / denom).cos();
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

fn find_delay_ms(recorded: &[f32], reference: &[f32], sample_rate: u32) -> Option<f32> {
    if recorded.is_empty() || reference.is_empty() || sample_rate == 0 {
        return None;
    }

    let rec_peak = recorded
        .iter()
        .copied()
        .fold(0.0f32, |acc, value| acc.max(value.abs()))
        .max(1e-12);
    let ref_peak = reference
        .iter()
        .copied()
        .fold(0.0f32, |acc, value| acc.max(value.abs()))
        .max(1e-12);

    let n = (recorded.len() + reference.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut a = vec![Complex { re: 0.0f32, im: 0.0f32 }; n];
    let mut b = vec![Complex { re: 0.0f32, im: 0.0f32 }; n];

    for (idx, value) in recorded.iter().enumerate() {
        a[idx].re = *value / rec_peak;
    }
    for (idx, value) in reference.iter().enumerate() {
        b[idx].re = *value / ref_peak;
    }

    fft.process(&mut a);
    fft.process(&mut b);

    for (x, y) in a.iter_mut().zip(b.iter()) {
        *x *= y.conj();
    }

    ifft.process(&mut a);

    let mut best_idx = 0usize;
    let mut best_val = f32::MIN;
    let max_lag = recorded.len().saturating_sub(1);

    for idx in 0..=max_lag.min(a.len().saturating_sub(1)) {
        let value = a[idx].re.abs();
        if value > best_val {
            best_val = value;
            best_idx = idx;
        }
    }

    let mut best_idx_f = best_idx as f32;
    if best_idx > 0 && best_idx + 1 < a.len() {
        let y1 = a[best_idx - 1].re.abs();
        let y2 = a[best_idx].re.abs();
        let y3 = a[best_idx + 1].re.abs();
        let denom = y1 - 2.0 * y2 + y3;
        if denom.abs() > 1e-12 {
            let frac = (y1 - y3) / (2.0 * denom);
            best_idx_f += frac.clamp(-1.0, 1.0);
        }
    }

    Some(best_idx_f * 1000.0 / sample_rate as f32)
}

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
) -> Result<Vec<Vec<f32>>, AudioError> {
    let signal = Arc::new(signal);
    let output_pos = Arc::new(AtomicUsize::new(0));
    let output_channels = output_config.channels as usize;
    let input_channels = expected_input_channels.max(1);

    let target_frames = (record_duration_secs.max(0.05) * input_config.sample_rate.0 as f32)
        .round() as usize;
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
    std::thread::sleep(Duration::from_secs_f32(playback_secs + guard));

    drop(output_stream);
    drop(input_stream);

    let captured = recorded.lock().map_err(|_| AudioError::Cancelled)?.clone();

    Ok(captured)
}

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
            seed: if seed == 0 { 0xA5A5_A5A5_A5A5_A5A5 } else { seed },
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
        self.b2 = 0.96900 * self.b2 + x * 0.153_852_0;
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

    let mut frame_count = 0usize;
    let mut sum_sq = 0.0f32;
    let mut clips = 0u32;

    for frame in samples.chunks(channels.max(1)) {
        if frame.is_empty() {
            continue;
        }
        let mono = frame.iter().copied().sum::<f32>() / frame.len() as f32;
        sum_sq += mono * mono;
        if mono.abs() >= 0.98 {
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
    }
}

fn read_monitor_f32(data: &[f32], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    update_monitor_stats(data, channels, stats);
}

fn read_monitor_i16(data: &[i16], channels: usize, stats: &Arc<Mutex<MonitorStats>>) {
    let converted: Vec<f32> = data.iter().map(|sample| *sample as f32 / i16::MAX as f32).collect();
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
