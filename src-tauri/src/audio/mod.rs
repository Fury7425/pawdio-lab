use std::{
    f32::consts::PI,
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
use rand::Rng;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyTestRequest {
    pub signal: TestSignalKind,
    pub frequency_hz: f32,
    pub duration_secs: f32,
    pub amplitude: f32,
    pub repeats: u32,
    pub record_margin_secs: f32,
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
pub struct LatencyMeasurement {
    pub iteration: u32,
    pub delay_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
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
    #[error("latency test cancelled")]
    Cancelled,
}

pub struct AudioEngine {
    settings: AudioSettings,
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
        let host = preferred_host()?;
        let output_entries = enumerate_output_devices(&host)?;
        let input_entries = enumerate_input_devices(&host)?;
        let output_device = select_device(
            &host,
            &output_entries,
            settings.output_device_index,
            false,
        )?;
        let input_device = select_device(&host, &input_entries, settings.input_device_index, true)?;

        let (output_config, output_format) =
            choose_output_config(&output_device, settings.output_sample_rate)?;
        let (input_config, input_format) =
            choose_input_config(&input_device, settings.input_sample_rate)?;

        let output_rate = output_config.sample_rate.0;
        let input_rate = input_config.sample_rate.0;

        let repeats = request.repeats.clamp(1, 128);
        let effective_duration = if request.duration_secs > 0.0 {
            request.duration_secs
        } else {
            settings.duration_secs
        }
        .clamp(0.03, 12.0);
        let amplitude = request.amplitude.clamp(0.01, 1.0);
        let margin = request.record_margin_secs.clamp(0.1, 6.0);

        let mut measurements = Vec::with_capacity(repeats as usize);
        for iteration in 1..=repeats {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let signal = generate_signal(
                request.signal,
                request.frequency_hz.max(20.0),
                effective_duration,
                amplitude,
                output_rate,
            );
            let record_duration = effective_duration + margin;
            let recorded = play_and_record(
                &output_device,
                &input_device,
                signal.clone(),
                output_config.clone(),
                output_format,
                input_config.clone(),
                input_format,
                record_duration,
            )?;
            let reference = if input_rate != output_rate {
                resample_linear(&signal, output_rate, input_rate)
            } else {
                signal
            };
            let delay = find_delay_ms(&recorded, &reference, input_rate);
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
            std::thread::sleep(Duration::from_millis(60));
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
        let cancelled = cancel.load(Ordering::SeqCst) && (measurements.len() < repeats as usize);

        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        let report = LatencyTestReport {
            signal: request.signal,
            sample_rate: output_rate,
            input_sample_rate: input_rate,
            measurements,
            average_delay_ms: average_delay,
            std_dev_ms: std_dev,
            cancelled,
            timestamp_utc: timestamp,
        };
        let _ = app.emit("latency-complete", report.clone());
        Ok(report)
    }
}

fn preferred_host() -> Result<Host, AudioError> {
    #[cfg(target_os = "windows")]
    {
        match cpal::host_from_id(cpal::HostId::Wasapi) {
            Ok(host) => Ok(host),
            Err(_) => Ok(cpal::default_host()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(cpal::default_host())
    }
}

fn enumerate_output_devices(host: &Host) -> Result<Vec<(Device, AudioDeviceInfo)>, AudioError> {
    let mut output_devices = Vec::new();
    for device in host.devices()? {
        if let Ok(config) = device.default_output_config() {
            let index = output_devices.len();
            output_devices.push((
                device.clone(),
                AudioDeviceInfo {
                    index,
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
    for device in host.devices()? {
        if let Ok(config) = device.default_input_config() {
            let index = input_devices.len();
            input_devices.push((
                device.clone(),
                AudioDeviceInfo {
                    index,
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
    let center = total_samples / 2;
    signal[center] = amplitude;
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

fn play_and_record(
    output_device: &Device,
    input_device: &Device,
    signal: Vec<f32>,
    output_config: StreamConfig,
    output_format: SampleFormat,
    input_config: StreamConfig,
    input_format: SampleFormat,
    record_duration_secs: f32,
) -> Result<Vec<f32>, AudioError> {
    let captured = Arc::new(Mutex::new(Vec::<f32>::new()));
    let play_data = Arc::new(signal);
    let play_cursor = Arc::new(AtomicUsize::new(0));
    let capture_buffer = Arc::clone(&captured);
    let output_stream = build_output_stream(
        output_device,
        output_format,
        output_config.clone(),
        Arc::clone(&play_data),
        Arc::clone(&play_cursor),
    )?;
    let input_stream = build_input_stream(
        input_device,
        input_format,
        input_config.clone(),
        capture_buffer,
    )?;

    input_stream.play()?;
    output_stream.play()?;
    std::thread::sleep(Duration::from_secs_f32(record_duration_secs.max(0.1)));
    drop(output_stream);
    drop(input_stream);

    let mut data = captured.lock().map(|buffer| buffer.clone()).unwrap_or_default();
    let wanted = (record_duration_secs * input_config.sample_rate.0 as f32) as usize;
    if data.len() > wanted && wanted > 0 {
        data.truncate(wanted);
    }
    Ok(data)
}

fn build_output_stream(
    device: &Device,
    format: SampleFormat,
    config: StreamConfig,
    signal: Arc<Vec<f32>>,
    cursor: Arc<AtomicUsize>,
) -> Result<Stream, AudioError> {
    let channels = config.channels as usize;
    let error_callback = |error| eprintln!("output stream error: {error}");
    match format {
        SampleFormat::F32 => device
            .build_output_stream(
                &config,
                move |output: &mut [f32], _| write_output_f32(output, channels, &signal, &cursor),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        SampleFormat::I16 => device
            .build_output_stream(
                &config,
                move |output: &mut [i16], _| write_output_i16(output, channels, &signal, &cursor),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        SampleFormat::U16 => device
            .build_output_stream(
                &config,
                move |output: &mut [u16], _| write_output_u16(output, channels, &signal, &cursor),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn build_input_stream(
    device: &Device,
    format: SampleFormat,
    config: StreamConfig,
    captured: Arc<Mutex<Vec<f32>>>,
) -> Result<Stream, AudioError> {
    let channels = config.channels as usize;
    let error_callback = |error| eprintln!("input stream error: {error}");
    match format {
        SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |input: &[f32], _| read_input_f32(input, channels, &captured),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        SampleFormat::I16 => device
            .build_input_stream(
                &config,
                move |input: &[i16], _| read_input_i16(input, channels, &captured),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        SampleFormat::U16 => device
            .build_input_stream(
                &config,
                move |input: &[u16], _| read_input_u16(input, channels, &captured),
                error_callback,
                None,
            )
            .map_err(AudioError::from),
        other => Err(AudioError::UnsupportedSampleFormat(format!("{other:?}"))),
    }
}

fn write_output_f32(
    output: &mut [f32],
    channels: usize,
    signal: &Arc<Vec<f32>>,
    cursor: &Arc<AtomicUsize>,
) {
    for frame in output.chunks_mut(channels.max(1)) {
        let index = cursor.fetch_add(1, Ordering::Relaxed);
        let sample = signal.get(index).copied().unwrap_or(0.0);
        for value in frame.iter_mut() {
            *value = sample;
        }
    }
}

fn write_output_i16(
    output: &mut [i16],
    channels: usize,
    signal: &Arc<Vec<f32>>,
    cursor: &Arc<AtomicUsize>,
) {
    for frame in output.chunks_mut(channels.max(1)) {
        let index = cursor.fetch_add(1, Ordering::Relaxed);
        let sample = signal.get(index).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let mapped = (sample * i16::MAX as f32) as i16;
        for value in frame.iter_mut() {
            *value = mapped;
        }
    }
}

fn write_output_u16(
    output: &mut [u16],
    channels: usize,
    signal: &Arc<Vec<f32>>,
    cursor: &Arc<AtomicUsize>,
) {
    for frame in output.chunks_mut(channels.max(1)) {
        let index = cursor.fetch_add(1, Ordering::Relaxed);
        let sample = signal.get(index).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        let mapped = (((sample + 1.0) * 0.5) * u16::MAX as f32) as u16;
        for value in frame.iter_mut() {
            *value = mapped;
        }
    }
}

fn read_input_f32(input: &[f32], channels: usize, captured: &Arc<Mutex<Vec<f32>>>) {
    if let Ok(mut buffer) = captured.lock() {
        for frame in input.chunks(channels.max(1)) {
            if let Some(sample) = frame.first() {
                buffer.push(*sample);
            }
        }
    }
}

fn read_input_i16(input: &[i16], channels: usize, captured: &Arc<Mutex<Vec<f32>>>) {
    if let Ok(mut buffer) = captured.lock() {
        for frame in input.chunks(channels.max(1)) {
            if let Some(sample) = frame.first() {
                buffer.push(*sample as f32 / i16::MAX as f32);
            }
        }
    }
}

fn read_input_u16(input: &[u16], channels: usize, captured: &Arc<Mutex<Vec<f32>>>) {
    if let Ok(mut buffer) = captured.lock() {
        for frame in input.chunks(channels.max(1)) {
            if let Some(sample) = frame.first() {
                let normalized = (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0;
                buffer.push(normalized);
            }
        }
    }
}

fn resample_linear(input: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if input.is_empty() || source_rate == target_rate {
        return input.to_vec();
    }
    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((input.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for idx in 0..output_len {
        let source_pos = idx as f64 / ratio;
        let left = source_pos.floor() as usize;
        let right = (left + 1).min(input.len() - 1);
        let frac = (source_pos - left as f64) as f32;
        let sample = input[left] + (input[right] - input[left]) * frac;
        output.push(sample);
    }
    output
}

fn normalize(signal: &[f32]) -> Vec<f32> {
    let peak = signal
        .iter()
        .copied()
        .fold(0.0f32, |acc, val| acc.max(val.abs()))
        .max(1e-9);
    signal.iter().map(|value| *value / peak).collect()
}

fn find_delay_ms(recorded: &[f32], reference: &[f32], sample_rate: u32) -> Option<f32> {
    if recorded.is_empty() || reference.is_empty() || sample_rate == 0 {
        return None;
    }
    let normalized_recorded = normalize(recorded);
    let normalized_reference = normalize(reference);
    let correlation = cross_correlate_fft(&normalized_recorded, &normalized_reference);
    if correlation.is_empty() {
        return None;
    }
    let mut peak_index = 0usize;
    let mut peak_value = 0.0f32;
    for (index, value) in correlation.iter().enumerate() {
        if value.abs() > peak_value {
            peak_value = value.abs();
            peak_index = index;
        }
    }
    let mut fractional = peak_index as f32;
    if peak_index > 0 && peak_index + 1 < correlation.len() {
        let y1 = correlation[peak_index - 1];
        let y2 = correlation[peak_index];
        let y3 = correlation[peak_index + 1];
        let denominator = y1 - (2.0 * y2) + y3;
        if denominator.abs() > 1e-9 {
            let correction = (y1 - y3) / (2.0 * denominator);
            fractional += correction;
        }
    }
    let delay_samples = fractional - (reference.len() as f32 - 1.0);
    Some(delay_samples * 1000.0 / sample_rate as f32)
}

fn cross_correlate_fft(signal: &[f32], reference: &[f32]) -> Vec<f32> {
    let full_len = signal.len() + reference.len() - 1;
    let fft_len = full_len.next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(fft_len);
    let inverse = planner.plan_fft_inverse(fft_len);

    let mut lhs = vec![Complex::<f32>::new(0.0, 0.0); fft_len];
    let mut rhs = vec![Complex::<f32>::new(0.0, 0.0); fft_len];

    for (idx, sample) in signal.iter().enumerate() {
        lhs[idx].re = *sample;
    }
    for (idx, sample) in reference.iter().rev().enumerate() {
        rhs[idx].re = *sample;
    }

    forward.process(&mut lhs);
    forward.process(&mut rhs);

    for (left, right) in lhs.iter_mut().zip(rhs.iter()) {
        *left *= *right;
    }

    inverse.process(&mut lhs);
    let scale = 1.0 / fft_len as f32;
    lhs.into_iter()
        .take(full_len)
        .map(|value| value.re * scale)
        .collect()
}

fn mean(values: &[f32]) -> f32 {
    values.iter().copied().sum::<f32>() / values.len() as f32
}

fn standard_deviation(values: &[f32], mean_value: f32) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let variance = values
        .iter()
        .map(|item| {
            let diff = *item - mean_value;
            diff * diff
        })
        .sum::<f32>()
        / values.len() as f32;
    variance.sqrt()
}
