//! Marker-based measurement alignment.
//!
//! A wired capture can be aligned by cross-correlating the recording against
//! the excitation itself: the clocks agree, so one delay figure is enough. A
//! wireless capture cannot. The link resamples, the codec buffers, and the
//! playback and capture clocks drift apart over the length of a sweep, so a
//! single delay estimate lands the window in roughly the right place and still
//! smears the high end of the response.
//!
//! This module surrounds the excitation with short coded marker packets and
//! locks onto those instead. One marker before the sweep fixes the start. Two
//! distinguishable markers after it fix the end, which gives both a redundancy
//! check and a measurement of how far the two clocks moved apart during the
//! capture. The drift figure is then used to resample the extracted window back
//! to nominal length.
//!
//! Every function here is pure: it takes recorded samples and a layout, and
//! touches neither devices nor app state. That is what lets the timing behaviour
//! be tested against synthetic recordings with no hardware attached.

use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};

/// Which coded packet a marker is. Each code uses a different tone set and sign
/// pattern so a loud resonance cannot make one end marker look like the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerCode {
    Start,
    EndA,
    EndB,
}

impl MarkerCode {
    fn duration_secs(self) -> f32 {
        match self {
            MarkerCode::Start => 0.056,
            MarkerCode::EndA | MarkerCode::EndB => 0.072,
        }
    }

    fn tones(self) -> [f32; 7] {
        match self {
            MarkerCode::Start => [650.0, 980.0, 1500.0, 2300.0, 3500.0, 5400.0, 7600.0],
            MarkerCode::EndA => [600.0, 950.0, 1450.0, 2300.0, 3600.0, 5600.0, 7600.0],
            MarkerCode::EndB => [760.0, 1180.0, 1780.0, 2750.0, 4300.0, 6500.0, 7900.0],
        }
    }

    /// Per-chip sign pattern. Distinct between codes, and balanced enough that
    /// no code correlates strongly with a time-shifted copy of another.
    fn signs(self) -> [f32; 7] {
        match self {
            MarkerCode::Start => [1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0],
            MarkerCode::EndA => [1.0, -1.0, 1.0, 1.0, 1.0, -1.0, -1.0],
            MarkerCode::EndB => [-1.0, 1.0, 1.0, -1.0, 1.0, -1.0, 1.0],
        }
    }
}

/// Confidence floors and the drift budget. Wireless captures need much looser
/// values than wired ones, so the two presets differ by roughly a factor of
/// three on confidence and a factor of three on drift.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSettings {
    pub start_confidence_min: f32,
    pub end_marker_confidence_min: f32,
    pub timing_drift_max_ms: f32,
}

impl AlignmentSettings {
    pub fn standard() -> Self {
        Self {
            start_confidence_min: 9.0,
            end_marker_confidence_min: 7.0,
            timing_drift_max_ms: 35.0,
        }
    }

    pub fn bluetooth() -> Self {
        Self {
            start_confidence_min: 3.0,
            end_marker_confidence_min: 2.5,
            timing_drift_max_ms: 120.0,
        }
    }

    pub fn for_mode(bluetooth: bool) -> Self {
        if bluetooth {
            Self::bluetooth()
        } else {
            Self::standard()
        }
    }
}

/// Timing padding around the excitation, plus the extra settling that
/// steady-state tone tests need on a wireless link.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementProfile {
    /// Silence before the start marker, giving the link time to open.
    pub pre_silence_secs: f32,
    /// Silence after the last end marker, covering the output tail.
    pub post_silence_secs: f32,
    /// Gap between a marker and its neighbour.
    pub marker_gap_secs: f32,
    /// Low-level burst that wakes a power-saving wireless output before the
    /// timing-critical part of the signal begins. Zero disables it.
    pub wake_primer_secs: f32,
    /// Recording time added past the end of playback.
    pub record_margin_secs: f32,
    /// Extra settle applied by the steady-state tone tests.
    pub settle_secs: f32,
}

impl MeasurementProfile {
    pub fn standard() -> Self {
        Self {
            pre_silence_secs: 0.2,
            post_silence_secs: 0.5,
            marker_gap_secs: 0.08,
            wake_primer_secs: 0.0,
            record_margin_secs: 0.5,
            settle_secs: 0.0,
        }
    }

    pub fn bluetooth() -> Self {
        Self {
            pre_silence_secs: 0.6,
            post_silence_secs: 2.0,
            marker_gap_secs: 0.15,
            wake_primer_secs: 0.35,
            record_margin_secs: 2.5,
            settle_secs: 0.6,
        }
    }

    pub fn for_mode(bluetooth: bool) -> Self {
        if bluetooth {
            Self::bluetooth()
        } else {
            Self::standard()
        }
    }
}

/// The playback buffer plus the sample offsets of everything inside it.
#[derive(Debug, Clone)]
pub struct MeasurementLayout {
    pub sample_rate: u32,
    pub playback: Vec<f32>,
    pub start_marker: Vec<f32>,
    pub end_marker_a: Vec<f32>,
    pub end_marker_b: Vec<f32>,
    pub start_marker_at: usize,
    pub excitation_at: usize,
    pub excitation_len: usize,
    pub end_marker_a_at: usize,
    pub end_marker_b_at: usize,
    pub total_samples: usize,
}

impl MeasurementLayout {
    /// Nominal spacing between the two end markers.
    pub fn end_marker_spacing(&self) -> usize {
        self.end_marker_b_at.saturating_sub(self.end_marker_a_at)
    }

    /// Nominal distance from the start marker to the first end marker. Both
    /// ends are marker positions, so measuring drift across this span compares
    /// like with like.
    pub fn marker_span(&self) -> usize {
        self.end_marker_a_at.saturating_sub(self.start_marker_at)
    }

    /// Nominal distance from the start marker to the first excitation sample.
    pub fn start_marker_to_excitation(&self) -> usize {
        self.excitation_at.saturating_sub(self.start_marker_at)
    }

    pub fn playback_duration_secs(&self) -> f32 {
        self.total_samples as f32 / self.sample_rate.max(1) as f32
    }
}

/// Why an alignment was rejected. Each variant maps to a message the user can
/// act on, and to whether retrying the same capture is worthwhile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignmentFailure {
    ShortRecording,
    LowStartConfidence,
    LowEndMarkerConfidence,
    EndMarkerUnverified,
    TimingDriftTooLarge,
    ShortAlignedRecording,
}

impl AlignmentFailure {
    pub fn message(self) -> &'static str {
        match self {
            AlignmentFailure::ShortRecording => {
                "Recording was shorter than the measurement signal. Check the input device."
            }
            AlignmentFailure::LowStartConfidence => {
                "Could not lock onto the start marker. Raise the output level, reduce background noise, or enable Bluetooth mode."
            }
            AlignmentFailure::LowEndMarkerConfidence => {
                "Could not lock onto the end markers. The capture may have been cut short or interrupted."
            }
            AlignmentFailure::EndMarkerUnverified => {
                "The two end markers disagreed about the timing. Discard this sweep and retry."
            }
            AlignmentFailure::TimingDriftTooLarge => {
                "The playback and capture clocks drifted beyond the allowed budget. Retry, and enable Bluetooth mode for a wireless device."
            }
            AlignmentFailure::ShortAlignedRecording => {
                "The aligned window did not contain a complete sweep."
            }
        }
    }

    /// Whether the same capture is worth attempting again unchanged. A drift or
    /// marker disagreement is often transient; a short recording is not.
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            AlignmentFailure::LowStartConfidence
                | AlignmentFailure::LowEndMarkerConfidence
                | AlignmentFailure::EndMarkerUnverified
                | AlignmentFailure::TimingDriftTooLarge
        )
    }
}

/// Everything the alignment measured, reported whether or not it passed. These
/// travel to the UI so a rejected sweep can say which number was out of range.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentDiagnostics {
    pub bluetooth_mode: bool,
    pub start_confidence: f32,
    /// Start peak height over the best competing peak. Infinite when nothing
    /// else in the recording came close.
    pub start_separation: f32,
    pub end_marker_confidence: f32,
    pub end_marker_agreement: f32,
    pub timing_error_ms: f32,
    pub drift_ratio: f32,
    pub snr_db: Option<f32>,
    pub excitation_start_sample: usize,
    pub failure: Option<AlignmentFailure>,
}

#[derive(Debug, Clone)]
pub struct AlignedMeasurement {
    /// The excitation window, resampled back to its nominal length.
    pub samples: Vec<f32>,
    pub diagnostics: AlignmentDiagnostics,
}

#[derive(Debug, Clone)]
pub struct AlignmentError {
    pub failure: AlignmentFailure,
    pub diagnostics: AlignmentDiagnostics,
}

impl AlignmentError {
    /// The reason, followed by the measurement that missed its threshold.
    /// Naming the number is what turns "it failed" into something the user can
    /// act on: a low lock asks for more level, a large timing error asks for a
    /// retry or for wireless mode.
    pub fn message(&self) -> String {
        let detail = match self.failure {
            AlignmentFailure::LowStartConfidence => {
                format!(" (start lock {:.1}x)", self.diagnostics.start_confidence)
            }
            AlignmentFailure::LowEndMarkerConfidence => {
                format!(" (end lock {:.1}x)", self.diagnostics.end_marker_confidence)
            }
            AlignmentFailure::TimingDriftTooLarge => {
                format!(" (timing error {:.0} ms)", self.diagnostics.timing_error_ms)
            }
            AlignmentFailure::EndMarkerUnverified => format!(
                " (marker spacing off by {:.0}%)",
                (self.diagnostics.end_marker_agreement - 1.0) * 100.0
            ),
            AlignmentFailure::ShortRecording | AlignmentFailure::ShortAlignedRecording => {
                String::new()
            }
        };
        format!("{}{detail}", self.failure.message())
    }
}

/// Build one coded marker packet.
///
/// The packet is a run of short chips, each a different tone with a
/// code-specific sign. Spreading energy across the band keeps the correlation
/// peak sharp through a codec that mangles any one region, and the sign pattern
/// is what makes the two end markers tell each other apart.
pub fn build_coded_timing_marker(sample_rate: u32, code: MarkerCode) -> Vec<f32> {
    if sample_rate == 0 {
        return Vec::new();
    }
    let duration = code.duration_secs();
    let total = ((duration * sample_rate as f32).round() as usize).max(32);
    let tones = code.tones();
    let signs = code.signs();
    let chip_count = tones.len();

    let mut marker = vec![0.0f32; total];
    for chip in 0..chip_count {
        let start = total * chip / chip_count;
        let end = total * (chip + 1) / chip_count;
        let chip_len = end.saturating_sub(start);
        if chip_len == 0 {
            continue;
        }
        let freq = tones[chip];
        let sign = signs[chip];
        for index in 0..chip_len {
            let time = (start + index) as f32 / sample_rate as f32;
            let window = hann_at(index, chip_len);
            let phase = std::f32::consts::TAU * freq * time;
            marker[start + index] = sign * window * phase.sin();
        }
    }

    // Taper the packet edges so the marker cannot click on a slow output path.
    let fade = (total / 20).max(1);
    for index in 0..fade {
        let gain = index as f32 / fade as f32;
        marker[index] *= gain;
        let tail = total - 1 - index;
        marker[tail] *= gain;
    }

    let peak = marker
        .iter()
        .fold(0.0f32, |accumulator, value| accumulator.max(value.abs()))
        .max(1e-9);
    for value in marker.iter_mut() {
        *value = *value / peak * 0.5;
    }
    marker
}

fn hann_at(index: usize, len: usize) -> f32 {
    if len <= 1 {
        return 1.0;
    }
    let ratio = index as f32 / (len - 1) as f32;
    0.5 - 0.5 * (std::f32::consts::TAU * ratio).cos()
}

/// Assemble the full playback buffer around an excitation signal.
pub fn build_measurement_layout(
    sample_rate: u32,
    excitation: &[f32],
    profile: MeasurementProfile,
) -> MeasurementLayout {
    let rate = sample_rate.max(1);
    let secs_to_samples = |secs: f32| -> usize { (secs.max(0.0) * rate as f32).round() as usize };

    let start_marker = build_coded_timing_marker(rate, MarkerCode::Start);
    let end_marker_a = build_coded_timing_marker(rate, MarkerCode::EndA);
    let end_marker_b = build_coded_timing_marker(rate, MarkerCode::EndB);

    let primer_len = secs_to_samples(profile.wake_primer_secs);
    let pre_silence = secs_to_samples(profile.pre_silence_secs);
    let gap = secs_to_samples(profile.marker_gap_secs).max(1);
    let post_silence = secs_to_samples(profile.post_silence_secs);

    let start_marker_at = primer_len + pre_silence;
    let excitation_at = start_marker_at + start_marker.len() + gap;
    let excitation_len = excitation.len();
    let end_marker_a_at = excitation_at + excitation_len + gap;
    let end_marker_b_at = end_marker_a_at + end_marker_a.len() + gap;
    let total_samples = end_marker_b_at + end_marker_b.len() + post_silence;

    let mut playback = vec![0.0f32; total_samples];

    // A quiet band-limited primer wakes a power-saving wireless output without
    // contributing anything the marker search could latch onto.
    if primer_len > 0 {
        for (index, slot) in playback.iter_mut().enumerate().take(primer_len) {
            let time = index as f32 / rate as f32;
            let envelope = hann_at(index, primer_len);
            *slot = 0.02 * envelope * (std::f32::consts::TAU * 220.0 * time).sin();
        }
    }

    copy_into(&mut playback, &start_marker, start_marker_at);
    copy_into(&mut playback, excitation, excitation_at);
    copy_into(&mut playback, &end_marker_a, end_marker_a_at);
    copy_into(&mut playback, &end_marker_b, end_marker_b_at);

    MeasurementLayout {
        sample_rate: rate,
        playback,
        start_marker,
        end_marker_a,
        end_marker_b,
        start_marker_at,
        excitation_at,
        excitation_len,
        end_marker_a_at,
        end_marker_b_at,
        total_samples,
    }
}

fn copy_into(destination: &mut [f32], source: &[f32], offset: usize) {
    for (index, value) in source.iter().enumerate() {
        let target = offset + index;
        if target >= destination.len() {
            break;
        }
        destination[target] += *value;
    }
}

/// Valid-mode normalised cross-correlation.
///
/// The numerator comes from an FFT so the whole sweep can be searched in one
/// pass, and the per-offset signal energy comes from a running sum, which keeps
/// the result a true correlation coefficient rather than a level-weighted one.
/// Without that normalisation a loud passage anywhere in the recording outscores
/// the actual marker.
pub fn normalized_correlation(signal: &[f32], pattern: &[f32]) -> Vec<f32> {
    let signal_len = signal.len();
    let pattern_len = pattern.len();
    if pattern_len == 0 || signal_len < pattern_len {
        return Vec::new();
    }
    let output_len = signal_len - pattern_len + 1;

    let pattern_energy: f32 = pattern.iter().map(|value| value * value).sum();
    if pattern_energy <= 0.0 {
        return vec![0.0; output_len];
    }
    let pattern_norm = pattern_energy.sqrt();

    let n = (signal_len + pattern_len).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(n);
    let inverse = planner.plan_fft_inverse(n);

    let zero = Complex {
        re: 0.0f32,
        im: 0.0f32,
    };
    let mut a = vec![zero; n];
    let mut b = vec![zero; n];
    for (index, value) in signal.iter().enumerate() {
        a[index].re = *value;
    }
    for (index, value) in pattern.iter().enumerate() {
        b[index].re = *value;
    }

    forward.process(&mut a);
    forward.process(&mut b);
    for (left, right) in a.iter_mut().zip(b.iter()) {
        *left *= right.conj();
    }
    inverse.process(&mut a);

    // Running window energy of the signal, so each offset divides by its own norm.
    let mut window_energy: f32 = signal
        .iter()
        .take(pattern_len)
        .map(|value| value * value)
        .sum();

    // A running sum loses precision as a large excitation slides out of the
    // window, leaving a tiny non-zero residue where the recording is actually
    // silent. Dividing by that residue turns rounding error into a correlation
    // of one, and the search then locks onto a gap instead of a marker. Refuse
    // to normalise a window carrying far less energy than the recording's own
    // average.
    let signal_energy: f32 = signal.iter().map(|value| value * value).sum();
    let energy_floor = (signal_energy / signal_len as f32) * pattern_len as f32 * 1e-4;

    let mut out = Vec::with_capacity(output_len);
    for offset in 0..output_len {
        if offset > 0 {
            let leaving = signal[offset - 1];
            let entering = signal[offset + pattern_len - 1];
            window_energy += entering * entering - leaving * leaving;
        }
        if window_energy <= energy_floor {
            out.push(0.0);
            continue;
        }
        let denominator = window_energy.max(0.0).sqrt() * pattern_norm;
        // `inverse` in rustfft is unnormalised, so divide the transform length out.
        let numerator = a[offset].re / n as f32;
        out.push(if denominator > 1e-12 {
            numerator / denominator
        } else {
            0.0
        });
    }
    out
}

/// Peak height relative to the typical value of the correlation. A clean lock
/// is a tall spike over a low floor, so this is the number that says whether a
/// marker was actually found rather than merely picked.
pub fn peak_to_rms_confidence(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let peak = values
        .iter()
        .fold(0.0f32, |accumulator, value| accumulator.max(value.abs()));
    let mean_square: f32 =
        values.iter().map(|value| value * value).sum::<f32>() / values.len() as f32;
    let rms = mean_square.sqrt();
    if rms <= 1e-12 {
        return 0.0;
    }
    peak / rms
}

/// Peak height relative to the best competing peak outside `exclusion` samples.
/// This is what catches a recording where a room reflection produces a second
/// candidate almost as strong as the direct arrival.
pub fn peak_to_next_best_confidence(values: &[f32], peak_index: usize, exclusion: usize) -> f32 {
    if values.is_empty() || peak_index >= values.len() {
        return 0.0;
    }
    let peak = values[peak_index].abs();
    let mut next_best = 0.0f32;
    for (index, value) in values.iter().enumerate() {
        let distance = index.abs_diff(peak_index);
        if distance <= exclusion {
            continue;
        }
        next_best = next_best.max(value.abs());
    }
    if next_best <= 1e-12 {
        return f32::INFINITY;
    }
    peak / next_best
}

fn argmax(values: &[f32]) -> Option<usize> {
    let mut best_index = None;
    let mut best_value = f32::MIN;
    for (index, value) in values.iter().enumerate() {
        let magnitude = value.abs();
        if magnitude > best_value {
            best_value = magnitude;
            best_index = Some(index);
        }
    }
    best_index
}

/// Peak position to better than one sample, by fitting a parabola through the
/// peak and its two neighbours.
///
/// One sample of error at 48 kHz is 21 microseconds, which is a fifth of a
/// cycle at 8 kHz. Aligning only to whole samples therefore smears the top of
/// every response, so the fractional part is worth recovering even though the
/// marker search itself is integer.
fn argmax_refined(values: &[f32]) -> Option<(usize, f64)> {
    let peak = argmax(values)?;
    if peak == 0 || peak + 1 >= values.len() {
        return Some((peak, peak as f64));
    }
    let left = values[peak - 1].abs();
    let centre = values[peak].abs();
    let right = values[peak + 1].abs();
    let denominator = left - 2.0 * centre + right;
    if denominator.abs() < 1e-12 {
        return Some((peak, peak as f64));
    }
    let shift = ((left - right) / (2.0 * denominator)).clamp(-1.0, 1.0);
    Some((peak, peak as f64 + shift as f64))
}

#[derive(Debug, Clone, Copy)]
pub struct StartAlignment {
    pub marker_at: usize,
    /// The marker position to sub-sample precision. Everything else is
    /// measured from here, so this is the one number that has to be right.
    pub marker_at_exact: f64,
    pub confidence: f32,
    /// How far the chosen peak stands above the best competing one. A tall
    /// peak with a near-equal rival means a reflection or an echo was as good
    /// a match as the direct arrival, which the height alone would not show.
    pub separation: f32,
}

/// Stretch a marker template by `ratio`.
///
/// A recording whose clock ran fast contains a marker that is physically
/// longer than the one that was played. Correlating it against the original
/// template still finds the packet, but the peak drifts towards the packet's
/// centre, which biases every distance measured from it. Matching the template
/// to the estimated stretch removes that bias.
fn stretched_marker(marker: &[f32], ratio: f64) -> Vec<f32> {
    if !(ratio.is_finite()) || (ratio - 1.0).abs() < 1e-6 || marker.len() < 8 {
        return marker.to_vec();
    }
    let target = ((marker.len() as f64) * ratio).round() as usize;
    resample_to_len(marker, target.max(8))
}

/// Locate the start marker.
pub fn find_start_alignment(
    recording: &[f32],
    layout: &MeasurementLayout,
    stretch: f64,
) -> Option<StartAlignment> {
    let template = stretched_marker(&layout.start_marker, stretch);
    let correlation = normalized_correlation(recording, &template);
    let (peak_index, peak_exact) = argmax_refined(&correlation)?;
    let confidence = peak_to_rms_confidence(&correlation);
    let separation = peak_to_next_best_confidence(&correlation, peak_index, template.len());
    Some(StartAlignment {
        marker_at: peak_index,
        marker_at_exact: peak_exact,
        confidence,
        separation,
    })
}

#[derive(Debug, Clone, Copy)]
pub struct EndMarkerAlignment {
    /// Marker A's position to sub-sample precision, which is what the drift
    /// ratio is measured from.
    pub marker_a_at_exact: f64,
    pub confidence: f32,
    /// How closely the two markers agree on the same time base, as a ratio of
    /// the measured spacing to the nominal spacing.
    pub agreement: f32,
}

/// Locate both end markers, searching only after the excitation is expected to
/// have finished so the sweep's own energy cannot win the correlation.
///
/// `start_marker_at` anchors the search and `stretch` is the current estimate
/// of the clock ratio, used both to place the search window and to shape the
/// templates.
pub fn find_end_markers(
    recording: &[f32],
    layout: &MeasurementLayout,
    start_marker_at: f64,
    stretch: f64,
) -> Option<EndMarkerAlignment> {
    let excitation_at = start_marker_at + layout.start_marker_to_excitation() as f64 * stretch;
    let search_from = ((excitation_at + layout.excitation_len as f64 * stretch)
        .max(0.0)
        .round() as usize)
        .min(recording.len());
    if search_from >= recording.len() {
        return None;
    }
    let window = &recording[search_from..];

    let template_a = stretched_marker(&layout.end_marker_a, stretch);
    let template_b = stretched_marker(&layout.end_marker_b, stretch);
    let correlation_a = normalized_correlation(window, &template_a);
    let correlation_b = normalized_correlation(window, &template_b);
    let (peak_a, peak_a_exact) = argmax_refined(&correlation_a)?;
    let (peak_b, _) = argmax_refined(&correlation_b)?;

    let marker_a_at = search_from + peak_a;
    let marker_b_at = search_from + peak_b;
    let marker_a_at_exact = search_from as f64 + peak_a_exact;

    let confidence =
        peak_to_rms_confidence(&correlation_a).min(peak_to_rms_confidence(&correlation_b));

    let nominal_spacing = layout.end_marker_spacing() as f32 * stretch as f32;
    let measured_spacing = marker_b_at as f32 - marker_a_at as f32;
    let agreement = if nominal_spacing > 0.0 {
        measured_spacing / nominal_spacing
    } else {
        0.0
    };

    Some(EndMarkerAlignment {
        marker_a_at_exact,
        confidence,
        agreement,
    })
}

/// Signal-to-noise estimate from the pre-marker silence against the excitation
/// window. Reported for diagnosis; it does not gate the measurement.
pub fn estimate_snr_db(
    recording: &[f32],
    layout: &MeasurementLayout,
    excitation_at: usize,
) -> Option<f32> {
    let noise_end = excitation_at
        .saturating_sub(layout.start_marker.len())
        .min(recording.len());
    if noise_end < layout.sample_rate as usize / 20 {
        return None;
    }
    let signal_end = (excitation_at + layout.excitation_len).min(recording.len());
    if signal_end <= excitation_at {
        return None;
    }
    let noise = mean_square(&recording[..noise_end]);
    let signal = mean_square(&recording[excitation_at..signal_end]);
    if noise <= 1e-20 || signal <= 1e-20 {
        return None;
    }
    Some(10.0 * (signal / noise).log10())
}

fn mean_square(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().map(|value| value * value).sum::<f32>() / values.len() as f32
}

/// Resample an arbitrary span of a recording to an exact number of samples.
///
/// `start` and `span` are in input samples and may be fractional, which is what
/// lets a sub-sample start offset and a measured drift ratio be corrected in
/// the same pass instead of rounding one away before applying the other.
pub fn resample_window(input: &[f32], start: f64, span: f64, target_len: usize) -> Vec<f32> {
    if input.is_empty() || target_len == 0 {
        return vec![0.0; target_len];
    }
    let last = (input.len() - 1) as isize;
    let step = if target_len > 1 {
        span / (target_len - 1) as f64
    } else {
        0.0
    };
    (0..target_len)
        .map(|index| {
            let position = start + index as f64 * step;
            let base = position.floor() as isize;
            let fraction = (position - base as f64) as f32;
            let sample = |offset: isize| -> f32 {
                let clamped = (base + offset).clamp(0, last) as usize;
                input[clamped]
            };
            catmull_rom(sample(-1), sample(0), sample(1), sample(2), fraction)
        })
        .collect()
}

/// Resample a whole slice to an exact target length.
pub fn resample_to_len(input: &[f32], target_len: usize) -> Vec<f32> {
    if input.is_empty() || target_len == 0 {
        return vec![0.0; target_len];
    }
    if input.len() == target_len {
        return input.to_vec();
    }
    resample_window(input, 0.0, (input.len() - 1) as f64, target_len)
}

fn catmull_rom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;
    0.5 * ((2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)
}

/// Align a recording to its layout and return the excitation window.
///
/// The window is located by the start marker, its true length is measured
/// against the first end marker, and it is resampled back to nominal length so
/// downstream analysis can treat it as if the clocks had agreed all along.
pub fn align_recording(
    recording: &[f32],
    layout: &MeasurementLayout,
    settings: AlignmentSettings,
    bluetooth_mode: bool,
) -> Result<AlignedMeasurement, AlignmentError> {
    let mut diagnostics = AlignmentDiagnostics {
        bluetooth_mode,
        drift_ratio: 1.0,
        ..AlignmentDiagnostics::default()
    };

    let fail =
        |diagnostics: &mut AlignmentDiagnostics, failure: AlignmentFailure| -> AlignmentError {
            diagnostics.failure = Some(failure);
            AlignmentError {
                failure,
                diagnostics: diagnostics.clone(),
            }
        };

    if recording.len() < layout.start_marker.len() + layout.excitation_len {
        return Err(fail(&mut diagnostics, AlignmentFailure::ShortRecording));
    }

    // Two passes. The first locates the markers with unstretched templates and
    // gets a rough clock ratio; the second repeats the search with templates
    // shaped to that ratio, which removes the bias a stretched packet puts on
    // its own correlation peak. One refinement is enough: the residual after it
    // is far below a sample over the length of a sweep.
    let mut stretch = 1.0f64;
    let mut start = find_start_alignment(recording, layout, stretch)
        .ok_or_else(|| fail(&mut diagnostics, AlignmentFailure::ShortRecording))?;

    // Judge the start lock before going any further. A capture with no signal
    // in it produces a start peak somewhere arbitrary, and searching for end
    // markers relative to that would report whatever the arbitrary position
    // happened to imply instead of the real problem.
    diagnostics.start_confidence = start.confidence;
    diagnostics.start_separation = start.separation;
    diagnostics.excitation_start_sample = start.marker_at;
    if start.confidence < settings.start_confidence_min {
        return Err(fail(&mut diagnostics, AlignmentFailure::LowStartConfidence));
    }

    let mut end = find_end_markers(recording, layout, start.marker_at_exact, stretch)
        .ok_or_else(|| fail(&mut diagnostics, AlignmentFailure::ShortRecording))?;

    let marker_span = layout.marker_span();
    let ratio_from = |start: &StartAlignment, end: &EndMarkerAlignment| -> f64 {
        let measured = end.marker_a_at_exact - start.marker_at_exact;
        if marker_span > 0 && measured > 0.0 {
            measured / marker_span as f64
        } else {
            1.0
        }
    };

    let first_ratio = ratio_from(&start, &end);
    // Only refine when the first estimate is credible. A wild ratio means the
    // markers were not really found, and re-searching with a nonsense template
    // would only make the failure harder to read.
    if (0.9..1.1).contains(&first_ratio) {
        stretch = first_ratio;
        if let Some(refined_start) = find_start_alignment(recording, layout, stretch) {
            start = refined_start;
        }
        if let Some(refined_end) =
            find_end_markers(recording, layout, start.marker_at_exact, stretch)
        {
            end = refined_end;
        }
    }

    diagnostics.start_confidence = start.confidence;
    diagnostics.start_separation = start.separation;
    if start.confidence < settings.start_confidence_min {
        return Err(fail(&mut diagnostics, AlignmentFailure::LowStartConfidence));
    }

    let drift_ratio = ratio_from(&start, &end);
    let excitation_at_exact =
        start.marker_at_exact + layout.start_marker_to_excitation() as f64 * drift_ratio;
    diagnostics.excitation_start_sample = excitation_at_exact.max(0.0).round() as usize;
    diagnostics.drift_ratio = drift_ratio as f32;
    diagnostics.snr_db = estimate_snr_db(recording, layout, diagnostics.excitation_start_sample);

    diagnostics.end_marker_confidence = end.confidence;
    diagnostics.end_marker_agreement = end.agreement;
    // How far the first end marker landed from where it would sit if the two
    // clocks agreed. This is the drift the resample below has to undo, so it
    // is what the budget limits. Measuring it against the drift-stretched
    // position instead would read ~0 by construction, since that stretch is
    // derived from this same marker.
    let undrifted_a = start.marker_at_exact + marker_span as f64;
    diagnostics.timing_error_ms =
        ((end.marker_a_at_exact - undrifted_a) * 1000.0 / layout.sample_rate as f64) as f32;

    if end.confidence < settings.end_marker_confidence_min {
        return Err(fail(
            &mut diagnostics,
            AlignmentFailure::LowEndMarkerConfidence,
        ));
    }

    // The two end markers are a fixed distance apart in the playback buffer. If
    // the recorded distance is far from that ratio, one of them was matched to
    // the wrong thing and the timing cannot be trusted.
    let agreement_tolerance = if bluetooth_mode { 0.25 } else { 0.1 };
    if (end.agreement - 1.0).abs() > agreement_tolerance {
        return Err(fail(
            &mut diagnostics,
            AlignmentFailure::EndMarkerUnverified,
        ));
    }

    if diagnostics.timing_error_ms.abs() > settings.timing_drift_max_ms {
        return Err(fail(
            &mut diagnostics,
            AlignmentFailure::TimingDriftTooLarge,
        ));
    }

    // Resample the span the excitation actually occupied straight to nominal
    // length, so the sub-sample start offset and the drift correction are
    // applied together rather than one being rounded away before the other.
    let recorded_span = (layout.excitation_len.saturating_sub(1)) as f64 * drift_ratio;
    let available = recording.len() as f64 - excitation_at_exact;
    if available <= 0.0 || recorded_span <= 0.0 || available * 2.0 < recorded_span {
        return Err(fail(
            &mut diagnostics,
            AlignmentFailure::ShortAlignedRecording,
        ));
    }

    let samples = resample_window(
        recording,
        excitation_at_exact,
        recorded_span,
        layout.excitation_len,
    );
    Ok(AlignedMeasurement {
        samples,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chirp(sample_rate: u32, duration_secs: f32) -> Vec<f32> {
        let total = (duration_secs * sample_rate as f32) as usize;
        let f0 = 100.0f32;
        let f1 = 8000.0f32;
        let ratio = (f1 / f0).ln();
        (0..total)
            .map(|index| {
                let t = index as f32 / sample_rate as f32;
                let phase = std::f32::consts::TAU * f0 * duration_secs / ratio
                    * ((ratio * t / duration_secs).exp() - 1.0);
                0.4 * phase.sin()
            })
            .collect()
    }

    /// Simulate a capture: silence, then the playback buffer delayed by
    /// `delay`, optionally resampled to emulate a clock running off-rate.
    fn simulate(
        layout: &MeasurementLayout,
        delay: usize,
        drift_ratio: f32,
        noise: f32,
    ) -> Vec<f32> {
        let stretched_len = ((layout.playback.len() as f32 * drift_ratio).round() as usize).max(1);
        let stretched = resample_to_len(&layout.playback, stretched_len);
        let mut out = vec![0.0f32; delay + stretched.len() + 4096];
        for (index, value) in stretched.iter().enumerate() {
            out[delay + index] = *value;
        }
        if noise > 0.0 {
            let mut seed = 0x2545F491u32;
            for value in out.iter_mut() {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let uniform = (seed >> 8) as f32 / 8_388_608.0 - 1.0;
                *value += uniform * noise;
            }
        }
        out
    }

    #[test]
    fn markers_are_distinguishable_from_each_other() {
        let start = build_coded_timing_marker(48_000, MarkerCode::Start);
        let end_a = build_coded_timing_marker(48_000, MarkerCode::EndA);
        let end_b = build_coded_timing_marker(48_000, MarkerCode::EndB);
        assert!(!start.is_empty() && !end_a.is_empty() && !end_b.is_empty());

        // Correlating A against B must be far weaker than A against itself.
        let self_peak = normalized_correlation(&end_a, &end_a)
            .into_iter()
            .fold(0.0f32, |acc, v| acc.max(v.abs()));
        let cross_peak = normalized_correlation(&end_a, &end_b)
            .into_iter()
            .fold(0.0f32, |acc, v| acc.max(v.abs()));
        assert!(self_peak > 0.95, "self peak was {self_peak}");
        assert!(
            cross_peak < 0.5,
            "cross peak {cross_peak} too close to self peak {self_peak}"
        );
    }

    #[test]
    fn layout_places_every_section_in_order() {
        let excitation = chirp(48_000, 0.5);
        let layout = build_measurement_layout(48_000, &excitation, MeasurementProfile::standard());
        assert!(layout.start_marker_at < layout.excitation_at);
        assert!(layout.excitation_at + layout.excitation_len <= layout.end_marker_a_at);
        assert!(layout.end_marker_a_at < layout.end_marker_b_at);
        assert_eq!(layout.playback.len(), layout.total_samples);
        assert_eq!(layout.excitation_len, excitation.len());
    }

    #[test]
    fn aligns_a_clean_delayed_capture() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 0.5);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::standard());
        let recording = simulate(&layout, 3_000, 1.0, 0.0);

        let aligned = align_recording(&recording, &layout, AlignmentSettings::standard(), false)
            .expect("clean capture should align");

        assert_eq!(aligned.samples.len(), excitation.len());
        let offset = aligned.diagnostics.excitation_start_sample as i64
            - (3_000 + layout.excitation_at) as i64;
        assert!(offset.abs() <= 2, "start offset was {offset} samples");
        assert!((aligned.diagnostics.drift_ratio - 1.0).abs() < 0.01);
    }

    #[test]
    fn recovers_the_sweep_from_a_drifting_capture() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 1.0);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::bluetooth());
        // 0.3% fast capture clock, far more drift than a wired path ever shows.
        let recording = simulate(&layout, 12_000, 1.003, 0.0005);

        let aligned = align_recording(&recording, &layout, AlignmentSettings::bluetooth(), true)
            .expect("drifting capture should still align");

        assert_eq!(aligned.samples.len(), excitation.len());
        assert!(
            (aligned.diagnostics.drift_ratio - 1.003).abs() < 0.002,
            "drift ratio was {}",
            aligned.diagnostics.drift_ratio
        );

        // The corrected window should track the original sweep closely.
        let correlation = correlation_coefficient(&aligned.samples, &excitation);
        assert!(
            correlation > 0.9,
            "correlation with source was {correlation}"
        );
    }

    #[test]
    fn drift_correction_beats_a_plain_delay_shift() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 1.0);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::bluetooth());
        let recording = simulate(&layout, 9_000, 1.004, 0.0);

        let aligned = align_recording(&recording, &layout, AlignmentSettings::bluetooth(), true)
            .expect("should align");

        // What the old path did: take the window at nominal length, no stretch.
        let start = aligned.diagnostics.excitation_start_sample;
        let naive: Vec<f32> = recording
            .iter()
            .skip(start)
            .take(excitation.len())
            .copied()
            .collect();

        let corrected = correlation_coefficient(&aligned.samples, &excitation);
        let uncorrected = correlation_coefficient(&naive, &excitation);
        assert!(
            corrected > uncorrected,
            "corrected {corrected} should beat uncorrected {uncorrected}"
        );
    }

    #[test]
    fn rejects_drift_beyond_the_timing_budget() {
        // A 2% clock ratio over a 3 s sweep puts the end marker ~65 ms late:
        // past the 35 ms wired budget. The drift-stretched comparison used to
        // report ~0 ms here and accept it.
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 3.0);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::standard());
        let recording = simulate(&layout, 4_000, 1.02, 0.0);

        let error = align_recording(&recording, &layout, AlignmentSettings::standard(), false)
            .expect_err("2% drift is far outside the wired budget");
        assert_eq!(error.failure, AlignmentFailure::TimingDriftTooLarge);
        assert!(
            error.diagnostics.timing_error_ms > 35.0,
            "timing error was {}",
            error.diagnostics.timing_error_ms
        );
    }

    #[test]
    fn reports_the_real_timing_error_for_small_drift() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 1.0);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::bluetooth());
        let recording = simulate(&layout, 12_000, 1.003, 0.0);
        let aligned = align_recording(&recording, &layout, AlignmentSettings::bluetooth(), true)
            .expect("small drift should align");
        let span_ms = layout.marker_span() as f32 * 1000.0 / sample_rate as f32;
        let expected = span_ms * 0.003;
        assert!(
            (aligned.diagnostics.timing_error_ms - expected).abs() < 0.5,
            "expected ~{expected:.2} ms, got {:.2} ms",
            aligned.diagnostics.timing_error_ms
        );
    }

    #[test]
    fn rejects_a_capture_with_no_signal_in_it() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 0.5);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::standard());
        let mut seed = 12345u32;
        let noise: Vec<f32> = (0..layout.total_samples + 8_000)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 8) as f32 / 8_388_608.0 - 1.0
            })
            .collect();

        let error = align_recording(&noise, &layout, AlignmentSettings::standard(), false)
            .expect_err("noise must not produce a measurement");
        assert_eq!(error.failure, AlignmentFailure::LowStartConfidence);
        assert!(error.failure.is_retryable());
    }

    #[test]
    fn rejects_a_truncated_capture() {
        let sample_rate = 48_000;
        let excitation = chirp(sample_rate, 0.5);
        let layout =
            build_measurement_layout(sample_rate, &excitation, MeasurementProfile::standard());
        let short = vec![0.0f32; layout.excitation_len / 4];
        let error = align_recording(&short, &layout, AlignmentSettings::standard(), false)
            .expect_err("a truncated capture must fail");
        assert_eq!(error.failure, AlignmentFailure::ShortRecording);
        assert!(!error.failure.is_retryable());
    }

    #[test]
    fn bluetooth_settings_are_looser_than_standard() {
        let standard = AlignmentSettings::standard();
        let bluetooth = AlignmentSettings::bluetooth();
        assert!(bluetooth.start_confidence_min < standard.start_confidence_min);
        assert!(bluetooth.timing_drift_max_ms > standard.timing_drift_max_ms);

        let standard_profile = MeasurementProfile::standard();
        let bluetooth_profile = MeasurementProfile::bluetooth();
        assert!(bluetooth_profile.pre_silence_secs > standard_profile.pre_silence_secs);
        assert!(bluetooth_profile.wake_primer_secs > 0.0);
        assert_eq!(standard_profile.wake_primer_secs, 0.0);
    }

    #[test]
    fn resample_to_len_preserves_endpoints() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let up = resample_to_len(&input, 250);
        assert_eq!(up.len(), 250);
        assert!((up[0] - 0.0).abs() < 1e-3);
        assert!((up[249] - 99.0).abs() < 1e-3);

        let down = resample_to_len(&input, 40);
        assert_eq!(down.len(), 40);
        assert!((down[39] - 99.0).abs() < 1e-3);
    }

    #[test]
    fn normalized_correlation_peaks_at_the_true_offset() {
        let pattern = build_coded_timing_marker(48_000, MarkerCode::Start);
        let mut signal = vec![0.0f32; 20_000];
        let offset = 7_531;
        for (index, value) in pattern.iter().enumerate() {
            signal[offset + index] = *value * 0.3;
        }
        let correlation = normalized_correlation(&signal, &pattern);
        let peak = argmax(&correlation).expect("a peak exists");
        assert_eq!(peak, offset);
        assert!(peak_to_rms_confidence(&correlation) > 9.0);
        assert!(peak_to_next_best_confidence(&correlation, peak, pattern.len()) > 2.0);
    }

    fn correlation_coefficient(left: &[f32], right: &[f32]) -> f32 {
        let len = left.len().min(right.len());
        if len == 0 {
            return 0.0;
        }
        let mut dot = 0.0f64;
        let mut left_energy = 0.0f64;
        let mut right_energy = 0.0f64;
        for index in 0..len {
            let a = left[index] as f64;
            let b = right[index] as f64;
            dot += a * b;
            left_energy += a * a;
            right_energy += b * b;
        }
        let denominator = (left_energy.sqrt() * right_energy.sqrt()).max(1e-12);
        (dot / denominator) as f32
    }
}
