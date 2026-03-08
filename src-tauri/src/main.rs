mod audio;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use audio::{
    AudioEngine, AudioSettings, BalanceRequest, CrosstalkRequest, DatabaseEntry, DeviceInventory,
    IsolationRequest, LatencyExportEntry, LatencyTestReport, LatencyTestRequest, SweepFrRequest,
    TestProgressEvent, TestResultPayload, ThdRequest, scan_database_entries,
};
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Clone)]
struct AppState {
    audio: Arc<tokio::sync::Mutex<AudioEngine>>,
    running: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    monitor_running: Arc<AtomicBool>,
    monitor_cancel: Arc<AtomicBool>,
    monitor_peak_reset: Arc<AtomicBool>,
    pink_noise_running: Arc<AtomicBool>,
    pink_noise_cancel: Arc<AtomicBool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    running: bool,
}

#[tauri::command]
async fn list_audio_devices(state: State<'_, AppState>) -> Result<DeviceInventory, String> {
    let engine = state.audio.lock().await;
    engine.list_devices().map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_audio_settings(state: State<'_, AppState>) -> Result<AudioSettings, String> {
    let engine = state.audio.lock().await;
    Ok(engine.settings())
}

#[tauri::command]
async fn set_audio_settings(
    state: State<'_, AppState>,
    settings: AudioSettings,
) -> Result<AudioSettings, String> {
    let mut engine = state.audio.lock().await;
    engine.set_settings(settings);
    Ok(engine.settings())
}

#[tauri::command]
async fn run_latency_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: LatencyTestRequest,
) -> Result<LatencyTestReport, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A latency test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();
    let app_handle = app.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_latency_test(settings, request, cancel, app_handle)
    });

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
async fn export_latency_report(
    state: State<'_, AppState>,
    request: LatencyTestRequest,
    report: LatencyTestReport,
    suite: Option<Vec<LatencyExportEntry>>,
) -> Result<String, String> {
    let item_name = {
        let engine = state.audio.lock().await;
        engine.settings().item_name
    };

    let result = if let Some(entries) = suite {
        if entries.is_empty() {
            AudioEngine::export_latency_report(&request, &report, &item_name)
        } else {
            AudioEngine::export_latency_suite_report(&request, &entries, &item_name)
        }
    } else {
        AudioEngine::export_latency_report(&request, &report, &item_name)
    };

    result
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_latency_overall_bar_chart(
    state: State<'_, AppState>,
    request: LatencyTestRequest,
    suite: Vec<LatencyExportEntry>,
) -> Result<String, String> {
    let item_name = {
        let engine = state.audio.lock().await;
        engine.settings().item_name
    };

    AudioEngine::save_latency_overall_bar_chart(&request, &suite, &item_name)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_sweep_fr_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SweepFrRequest,
) -> Result<TestResultPayload, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();
    let app_handle = app.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_sweep_fr_test(settings, request, cancel, app_handle)
    });

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
async fn start_input_monitor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.monitor_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    state.monitor_cancel.store(false, Ordering::SeqCst);
    state.monitor_peak_reset.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.monitor_cancel.clone();
    let peak_reset = state.monitor_peak_reset.clone();
    let app_handle = app.clone();
    let running_flag = state.monitor_running.clone();

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = AudioEngine::run_input_monitor(settings, cancel, peak_reset, app_handle.clone()) {
            let _ = app_handle.emit(
                "test-progress",
                TestProgressEvent {
                    test: "monitor".to_string(),
                    current: 0,
                    total: 0,
                    value: None,
                    message: format!("input monitor error: {error}"),
                },
            );
        }
        running_flag.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
fn stop_input_monitor(state: State<'_, AppState>) {
    state.monitor_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn reset_input_monitor_peak(state: State<'_, AppState>) {
    state.monitor_peak_reset.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn start_pink_noise(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Cannot start pink noise while a test is running.".to_string());
    }
    if state.pink_noise_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    state.pink_noise_cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.pink_noise_cancel.clone();
    let running_flag = state.pink_noise_running.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = AudioEngine::run_pink_noise(settings, cancel) {
            let _ = app_handle.emit(
                "test-progress",
                TestProgressEvent {
                    test: "pink_noise".to_string(),
                    current: 0,
                    total: 0,
                    value: None,
                    message: format!("pink noise error: {error}"),
                },
            );
        }
        running_flag.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
fn stop_pink_noise(state: State<'_, AppState>) {
    state.pink_noise_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn run_thd_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ThdRequest,
) -> Result<TestResultPayload, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();
    let app_handle = app.clone();

    let task =
        tauri::async_runtime::spawn_blocking(move || AudioEngine::run_thd_test(settings, request, cancel, app_handle));

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
async fn run_balance_test(
    state: State<'_, AppState>,
    request: BalanceRequest,
) -> Result<TestResultPayload, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();

    let task =
        tauri::async_runtime::spawn_blocking(move || AudioEngine::run_balance_test(settings, request, cancel));

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
async fn run_crosstalk_test(
    state: State<'_, AppState>,
    request: CrosstalkRequest,
) -> Result<TestResultPayload, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();

    let task =
        tauri::async_runtime::spawn_blocking(move || AudioEngine::run_crosstalk_test(settings, request, cancel));

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
async fn run_isolation_test(
    state: State<'_, AppState>,
    request: IsolationRequest,
) -> Result<TestResultPayload, String> {
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A test is already running.".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let settings = {
        let engine = state.audio.lock().await;
        engine.settings()
    };
    let cancel = state.cancel.clone();

    let task =
        tauri::async_runtime::spawn_blocking(move || AudioEngine::run_isolation_test(settings, request, cancel));

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio test task join error: {error}")),
    }
}

#[tauri::command]
fn stop_test(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
    state.monitor_cancel.store(true, Ordering::SeqCst);
    state.pink_noise_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn stop_latency_test(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn get_runtime_status(state: State<'_, AppState>) -> RuntimeStatus {
    RuntimeStatus {
        running: state.running.load(Ordering::SeqCst),
    }
}

#[tauri::command]
fn ensure_output_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("failed to create directory {}: {}", path, e))
}

#[tauri::command]
fn scan_database(output_dirs: Vec<String>) -> Vec<DatabaseEntry> {
    scan_database_entries(output_dirs)
}

fn main() {
    let app_state = AppState {
        audio: Arc::new(tokio::sync::Mutex::new(AudioEngine::new())),
        running: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        monitor_running: Arc::new(AtomicBool::new(false)),
        monitor_cancel: Arc::new(AtomicBool::new(false)),
        monitor_peak_reset: Arc::new(AtomicBool::new(false)),
        pink_noise_running: Arc::new(AtomicBool::new(false)),
        pink_noise_cancel: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
.invoke_handler(tauri::generate_handler![
            list_audio_devices,
            get_audio_settings,
            set_audio_settings,
            run_latency_test,
            export_latency_report,
            save_latency_overall_bar_chart,
            run_sweep_fr_test,
            start_input_monitor,
            stop_input_monitor,
            reset_input_monitor_peak,
            start_pink_noise,
            stop_pink_noise,
            run_thd_test,
            run_balance_test,
            run_crosstalk_test,
            run_isolation_test,
            stop_test,
            stop_latency_test,
            get_runtime_status,
            ensure_output_dir,
            scan_database
        ])
        .run(tauri::generate_context!())
        .expect("failed to run pawdio-lab tauri app");
}
