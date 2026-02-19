mod audio;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use audio::{
    AudioEngine, AudioSettings, BalanceRequest, CrosstalkRequest, DeviceInventory,
    IsolationRequest, LatencyTestReport, LatencyTestRequest, SweepFrRequest, TestResultPayload,
    ThdRequest,
};
use serde::Serialize;
use tauri::State;

#[derive(Clone)]
struct AppState {
    audio: Arc<tokio::sync::Mutex<AudioEngine>>,
    running: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
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
    request: LatencyTestRequest,
    report: LatencyTestReport,
) -> Result<String, String> {
    AudioEngine::export_latency_report(&request, &report)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_sweep_fr_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SweepFrRequest,
) -> Result<TestResultPayload, String> {
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
async fn run_thd_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ThdRequest,
) -> Result<TestResultPayload, String> {
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

fn main() {
    let app_state = AppState {
        audio: Arc::new(tokio::sync::Mutex::new(AudioEngine::new())),
        running: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            list_audio_devices,
            get_audio_settings,
            set_audio_settings,
            run_latency_test,
            export_latency_report,
            run_sweep_fr_test,
            run_thd_test,
            run_balance_test,
            run_crosstalk_test,
            run_isolation_test,
            stop_test,
            stop_latency_test,
            get_runtime_status
        ])
        .run(tauri::generate_context!())
        .expect("failed to run pawdio-lab tauri app");
}
