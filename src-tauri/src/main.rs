mod audio;
mod db;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use audio::{
    AncSnapshot, AncSnapshotRequest, AudioEngine, AudioSettings, BalanceRequest, CrosstalkRequest,
    DeviceInventory, IsolationRequest, LatencyExportEntry, LatencyTestReport, LatencyTestRequest,
    SweepFrRequest, TestProgressEvent, TestResultPayload, ThdRequest,
};
use db::{DeviceRecord, MeasurementRecord, MeasurementSummary};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// Reject paths that contain `..` traversal or are not absolute.
/// All export commands must call this before touching the filesystem.
fn validate_output_path(path: &std::path::Path) -> Result<(), String> {
    if path
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(format!(
            "Invalid path: '{}' contains '..' traversal",
            path.display()
        ));
    }
    if !path.is_absolute() {
        return Err(format!(
            "Invalid path: '{}' must be absolute",
            path.display()
        ));
    }
    Ok(())
}

#[derive(Clone)]
struct AppState {
    audio: Arc<tokio::sync::Mutex<AudioEngine>>,
    db: Arc<tokio::sync::Mutex<rusqlite::Connection>>,
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
async fn capture_anc_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: AncSnapshotRequest,
) -> Result<AncSnapshot, String> {
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
        AudioEngine::capture_anc_snapshot(settings, request, cancel, app_handle)
    });

    let join_result = task.await;
    state.running.store(false, Ordering::SeqCst);

    match join_result {
        Ok(inner) => inner.map_err(|error| error.to_string()),
        Err(error) => Err(format!("Audio task join error: {error}")),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AncModeExport {
    key: String,
    label: String,
    attenuation_left: Vec<f32>,
    attenuation_right: Vec<f32>,
}

#[tauri::command]
fn save_anc_plots(
    output_dir: String,
    timestamp: String,
    freqs: Vec<f32>,
    modes: Vec<AncModeExport>,
) -> Result<Vec<(String, String)>, String> {
    let dir = std::path::Path::new(&output_dir);
    validate_output_path(dir)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("failed to create output dir: {e}"))?;
    let mode_data: Vec<(&str, &str, Vec<f32>, Vec<f32>)> = modes
        .iter()
        .map(|m| {
            (
                m.key.as_str(),
                m.label.as_str(),
                m.attenuation_left.clone(),
                m.attenuation_right.clone(),
            )
        })
        .collect();
    audio::save_anc_plots(dir, &timestamp, &freqs, &mode_data).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_anc_squiglink(
    output_path: String,
    mode_label: String,
    freqs: Vec<f32>,
    attenuation_db: Vec<f32>,
) -> Result<(), String> {
    let path = std::path::Path::new(&output_path);
    validate_output_path(path)?;
    audio::save_anc_squiglink(path, &mode_label, &freqs, &attenuation_db).map_err(|e| e.to_string())
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
        if let Err(error) =
            AudioEngine::run_input_monitor(settings, cancel, peak_reset, app_handle.clone())
        {
            if let Err(emit_err) = app_handle.emit(
                "test-progress",
                TestProgressEvent {
                    test: "monitor".to_string(),
                    current: 0,
                    total: 0,
                    value: None,
                    message: format!("input monitor error: {error}"),
                },
            ) {
                eprintln!("Failed to emit monitor error event: {emit_err}");
            }
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
async fn start_pink_noise(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
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
            if let Err(emit_err) = app_handle.emit(
                "test-progress",
                TestProgressEvent {
                    test: "pink_noise".to_string(),
                    current: 0,
                    total: 0,
                    value: None,
                    message: format!("pink noise error: {error}"),
                },
            ) {
                eprintln!("Failed to emit pink noise error event: {emit_err}");
            }
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

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_thd_test(settings, request, cancel, app_handle)
    });

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

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_balance_test(settings, request, cancel)
    });

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

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_crosstalk_test(settings, request, cancel)
    });

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

    let task = tauri::async_runtime::spawn_blocking(move || {
        AudioEngine::run_isolation_test(settings, request, cancel)
    });

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
fn get_runtime_status(state: State<'_, AppState>) -> RuntimeStatus {
    RuntimeStatus {
        running: state.running.load(Ordering::SeqCst),
    }
}

#[tauri::command]
fn ensure_output_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    validate_output_path(p)?;
    std::fs::create_dir_all(p).map_err(|e| format!("failed to create directory {}: {}", path, e))
}

#[tauri::command]
fn write_text_export(
    output_dir: String,
    filename: String,
    content: String,
) -> Result<String, String> {
    let dir = std::path::Path::new(&output_dir);
    validate_output_path(dir)?;

    let filename_path = std::path::Path::new(&filename);
    if filename.is_empty()
        || filename_path.is_absolute()
        || filename_path.file_name() != Some(std::ffi::OsStr::new(&filename))
    {
        return Err(format!("Invalid export filename: '{filename}'"));
    }

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("failed to create output directory {}: {e}", dir.display()))?;
    let path = dir.join(filename_path);
    std::fs::write(&path, content)
        .map_err(|e| format!("failed to write export {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_squiglink_combined(
    output_path: String,
    freqs: Vec<f32>,
    left_db: Vec<f32>,
    right_db: Vec<f32>,
) -> Result<(), String> {
    let path = std::path::Path::new(&output_path);
    validate_output_path(path)?;
    audio::write_squiglink_both_file(path, &freqs, &left_db, &right_db).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn save_sweep_combined_plots(
    all_plot_path: Option<String>,
    avg_all_plot_path: Option<String>,
    lr_avg_plot_path: Option<String>,
    freqs: Vec<f32>,
    all_curves: Vec<Vec<f32>>,
    avg_all: Vec<f32>,
    left_avg: Vec<f32>,
    right_avg: Vec<f32>,
) -> Result<(), String> {
    let resolve = |value: &Option<String>| -> Result<Option<std::path::PathBuf>, String> {
        match value {
            Some(raw) if !raw.is_empty() => {
                let path = std::path::Path::new(raw);
                validate_output_path(path)?;
                Ok(Some(path.to_path_buf()))
            }
            _ => Ok(None),
        }
    };
    let all = resolve(&all_plot_path)?;
    let avg_all_path = resolve(&avg_all_plot_path)?;
    let lr_avg = resolve(&lr_avg_plot_path)?;
    audio::save_sweep_combined_plots(
        all.as_deref(),
        avg_all_path.as_deref(),
        lr_avg.as_deref(),
        &freqs,
        &all_curves,
        &avg_all,
        &left_avg,
        &right_avg,
    )
    .map_err(|e| e.to_string())
}

// Measurement library (SQLite) -----------------------------------------------

#[tauri::command]
async fn db_list_devices(state: State<'_, AppState>) -> Result<Vec<DeviceRecord>, String> {
    let conn = state.db.lock().await;
    db::list_devices(&conn)
}

#[tauri::command]
async fn db_create_device(
    state: State<'_, AppState>,
    name: String,
    kind: Option<String>,
) -> Result<DeviceRecord, String> {
    let conn = state.db.lock().await;
    db::create_device(&conn, &name, kind)
}

#[tauri::command]
async fn db_rename_device(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<DeviceRecord, String> {
    let conn = state.db.lock().await;
    db::rename_device(&conn, id, &name)
}

#[tauri::command]
async fn db_delete_device(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().await;
    db::delete_device(&conn, id)
}

#[tauri::command]
async fn db_list_measurements(
    state: State<'_, AppState>,
    device_id: Option<i64>,
    test_type: Option<String>,
) -> Result<Vec<MeasurementSummary>, String> {
    let conn = state.db.lock().await;
    db::list_measurements(&conn, device_id, test_type)
}

#[tauri::command]
async fn db_get_measurement(
    state: State<'_, AppState>,
    id: i64,
) -> Result<MeasurementRecord, String> {
    let conn = state.db.lock().await;
    db::get_measurement(&conn, id)
}

#[tauri::command]
async fn db_save_measurement(
    state: State<'_, AppState>,
    device_id: i64,
    test_type: String,
    label: Option<String>,
    payload: serde_json::Value,
) -> Result<MeasurementRecord, String> {
    let conn = state.db.lock().await;
    db::save_measurement(&conn, device_id, &test_type, label, &payload)
}

#[tauri::command]
async fn db_delete_measurement(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().await;
    db::delete_measurement(&conn, id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .map_err(|e| std::io::Error::other(format!("could not resolve app data dir: {e}")))?
                .join("pawdio-lab.db");
            let conn = db::init(&db_path).map_err(std::io::Error::other)?;

            app.manage(AppState {
                audio: Arc::new(tokio::sync::Mutex::new(AudioEngine::new())),
                db: Arc::new(tokio::sync::Mutex::new(conn)),
                running: Arc::new(AtomicBool::new(false)),
                cancel: Arc::new(AtomicBool::new(false)),
                monitor_running: Arc::new(AtomicBool::new(false)),
                monitor_cancel: Arc::new(AtomicBool::new(false)),
                monitor_peak_reset: Arc::new(AtomicBool::new(false)),
                pink_noise_running: Arc::new(AtomicBool::new(false)),
                pink_noise_cancel: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
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
            capture_anc_snapshot,
            save_anc_plots,
            save_anc_squiglink,
            stop_test,
            get_runtime_status,
            ensure_output_dir,
            write_text_export,
            write_squiglink_combined,
            save_sweep_combined_plots,
            db_list_devices,
            db_create_device,
            db_rename_device,
            db_delete_device,
            db_list_measurements,
            db_get_measurement,
            db_save_measurement,
            db_delete_measurement,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("Pawdio Lab failed to start: {err}");
            std::process::exit(1);
        });
}
