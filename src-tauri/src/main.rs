#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod audio;

use audio::commands::{get_devices, select_device, run_latency_test, AppState};
use audio::engine::AudioEngine;
use parking_lot::Mutex;

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            engine: Mutex::new(AudioEngine::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_devices,
            select_device,
            run_latency_test
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
