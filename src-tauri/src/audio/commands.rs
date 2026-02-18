use tauri::State;
use crate::audio::engine::AudioEngine;
use crate::audio::types::*;
use parking_lot::Mutex;

pub struct AppState {
    pub engine: Mutex<AudioEngine>,
}

#[tauri::command]
pub fn get_devices(state: State<AppState>) -> Vec<AudioDeviceInfo> {
    state.engine.lock().list_devices()
}

#[tauri::command]
pub fn select_device(state: State<AppState>, index: usize, is_input: bool) -> Result<(), String> {
    let mut engine = state.engine.lock();
    if is_input {
        engine.set_input_device(index).map_err(|e| e.to_string())
    } else {
        engine.set_output_device(index).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn run_latency_test(state: State<'_, AppState>) -> Result<LatencyResult, String> {
    let engine = state.engine.lock();
    engine.run_latency_test().await.map_err(|e| e.to_string())
}
