use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub index: usize,
    pub max_input_channels: u16,
    pub max_output_channels: u16,
    pub default_sample_rate: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LatencyResult {
    pub delay_ms: f32,
    pub jitter_ms: f32,
    pub success: bool,
}
