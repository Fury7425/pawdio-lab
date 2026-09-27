mod audio;
mod db;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use audio::{
    AncSnapshot, AncSnapshotRequest, AudioEngine, AudioSettings, BalanceRequest, CrosstalkRequest,
    DeviceInventory, LatencyExportEntry, LatencyTestReport, LatencyTestRequest, SweepFrRequest,
    TestProgressEvent, TestResultPayload, ThdRequest,
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

/// Validate a folder the user typed or picked, when one was given. An empty
/// value means "use the default export folder" and is always fine.
fn validate_requested_dir(dir: &Option<String>) -> Result<(), String> {
    match dir.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => validate_output_path(std::path::Path::new(raw)),
        _ => Ok(()),
    }
}

/// Wait briefly for a stream thread that was just told to stop to finish, so
/// an immediate restart is not swallowed by the old thread's running flag.
fn wait_for_stop(running: &AtomicBool, cancel: &AtomicBool) {
    if !cancel.load(Ordering::SeqCst) {
        return;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while running.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
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

impl AppState {
    /// Claim the single measurement slot, or report who holds it.
    ///
    /// The monitor and pink-noise streams are only stopped once this call has
    /// won the slot. Stopping them first, as every handler used to, meant a
    /// duplicate start that was then rejected still killed both streams as a
    /// side effect of a request that did nothing.
    fn begin_run(&self, busy_message: &str) -> Result<(), String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(busy_message.to_string());
        }
        self.monitor_cancel.store(true, Ordering::SeqCst);
        self.pink_noise_cancel.store(true, Ordering::SeqCst);
        self.cancel.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    running: bool,
}

/// Clears a "busy" flag when it goes out of scope, including while a panic
/// unwinds. The fire-and-forget monitor and pink-noise tasks are not awaited,
/// so a panic there would otherwise strand the flag at `true` and make every
/// later start a silent no-op.
struct FlagGuard(Arc<AtomicBool>);

impl Drop for FlagGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
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
    validate_requested_dir(&request.output_dir)?;
    validate_requested_dir(&request.shared_output_dir)?;
    state.begin_run("A latency test is already running.")?;

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
    validate_requested_dir(&request.output_dir)?;
    validate_requested_dir(&request.shared_output_dir)?;
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
    validate_requested_dir(&request.output_dir)?;
    validate_requested_dir(&request.shared_output_dir)?;
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
    validate_requested_dir(&request.output_dir)?;
    state.begin_run("A test is already running.")?;

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
    state.begin_run("A test is already running.")?;

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

/// ANC exports land in the same `((item)-(timestamp))` folder Sweep FR and
/// Latency use, and fall back to the default export dir when none is set.
async fn anc_output_dir(
    state: &State<'_, AppState>,
    output_dir: Option<String>,
    timestamp: &str,
) -> Result<std::path::PathBuf, String> {
    let item_name = {
        let engine = state.audio.lock().await;
        engine.settings().item_name
    };
    let requested = output_dir.filter(|dir| !dir.trim().is_empty());
    let dir = audio::resolve_measurement_output_dir(&requested, &item_name, timestamp);
    validate_output_path(&dir)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create output dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
async fn save_anc_plots(
    state: State<'_, AppState>,
    output_dir: Option<String>,
    timestamp: String,
    freqs: Vec<f32>,
    modes: Vec<AncModeExport>,
) -> Result<Vec<(String, String)>, String> {
    let dir = anc_output_dir(&state, output_dir, &timestamp).await?;
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
    audio::save_anc_plots(&dir, &timestamp, &freqs, &mode_data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_anc_squiglink(
    state: State<'_, AppState>,
    output_dir: Option<String>,
    timestamp: String,
    mode_key: String,
    mode_label: String,
    freqs: Vec<f32>,
    attenuation_db: Vec<f32>,
) -> Result<String, String> {
    let dir = anc_output_dir(&state, output_dir, &timestamp).await?;
    // Same sanitizer on both halves as save_anc_plots, so the TXT and the PNGs
    // of one run always carry an identical tag.
    let path = dir.join(format!(
        "anc_{}_{}.txt",
        audio::sanitize_output_name(&mode_key),
        audio::sanitize_output_name(&timestamp)
    ));
    audio::save_anc_squiglink(&path, &mode_label, &freqs, &attenuation_db)
        .map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
async fn start_input_monitor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Cannot start the input monitor while a test is running.".to_string());
    }
    wait_for_stop(&state.monitor_running, &state.monitor_cancel);
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
        let _flag = FlagGuard(running_flag);
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
    wait_for_stop(&state.pink_noise_running, &state.pink_noise_cancel);
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
        let _flag = FlagGuard(running_flag);
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
    state.begin_run("A test is already running.")?;

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
    state.begin_run("A test is already running.")?;

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
    state.begin_run("A test is already running.")?;

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

/// Hand a URL to the operating system's default browser.
///
/// Only the project's own GitHub host is accepted. The update check is the one
/// place the app links out, so there is no reason to let an arbitrary string
/// through to a shell.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    const ALLOWED_PREFIXES: [&str; 2] = [
        "https://github.com/Fury7425/pawdio-lab",
        "https://api.github.com/repos/Fury7425/pawdio-lab",
    ];
    if !ALLOWED_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
    {
        return Err(format!("Refusing to open unexpected URL: {url}"));
    }

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("failed to open browser: {error}"))
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
    // The check above only rejects separators and absolute paths. A bare name
    // can still carry a colon (an NTFS alternate data stream, which writes an
    // invisible file), a reserved device name, or a trailing dot, so run it
    // through the same sanitiser every other export path uses.
    let safe_name = audio::sanitize_output_name(&filename);

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("failed to create output directory {}: {e}", dir.display()))?;
    let path = dir.join(&safe_name);
    std::fs::write(&path, content)
        .map_err(|e| format!("failed to write export {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Write the Sweep FR plots and Squiglink files for the sweeps a user
/// accepted. Guided runs capture one sweep per call and let the user discard
/// bad ones, so the exports are written once, here, from the accepted curves
/// only.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_sweep_outputs(
    state: State<'_, AppState>,
    output_dir: Option<String>,
    run_tag: String,
    save_plots: bool,
    save_squiglink: bool,
    freqs: Vec<f32>,
    left_curves: Vec<Vec<f32>>,
    right_curves: Vec<Vec<f32>>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    validate_requested_dir(&output_dir)?;
    let item_name = {
        let engine = state.audio.lock().await;
        engine.settings().item_name
    };
    let tag = audio::sanitize_output_name(&run_tag);
    let dir = audio::resolve_measurement_output_dir(&output_dir, &item_name, &tag);
    validate_output_path(&dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        audio::write_sweep_outputs(
            &dir,
            &tag,
            save_plots,
            save_squiglink,
            &freqs,
            &left_curves,
            &right_curves,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Sweep export task join error: {e}"))?
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
    notes: Option<String>,
    captured_at: Option<i64>,
    payload: serde_json::Value,
) -> Result<MeasurementRecord, String> {
    let conn = state.db.lock().await;
    db::save_measurement(&conn, device_id, &test_type, label, notes, captured_at, &payload)
}

#[tauri::command]
async fn db_update_measurement(
    state: State<'_, AppState>,
    id: i64,
    label: Option<String>,
    notes: Option<String>,
) -> Result<MeasurementRecord, String> {
    let conn = state.db.lock().await;
    db::update_measurement(&conn, id, label, notes)
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
            capture_anc_snapshot,
            save_anc_plots,
            save_anc_squiglink,
            stop_test,
            get_runtime_status,
            open_external_url,
            write_text_export,
            save_sweep_outputs,
            db_list_devices,
            db_create_device,
            db_rename_device,
            db_delete_device,
            db_list_measurements,
            db_get_measurement,
            db_save_measurement,
            db_update_measurement,
            db_delete_measurement,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("Pawdio Lab failed to start: {err}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn validate_output_path_rejects_traversal_and_relative_paths() {
        assert!(validate_output_path(Path::new("exports")).is_err());
        assert!(validate_output_path(Path::new("../exports")).is_err());
        #[cfg(windows)]
        {
            assert!(validate_output_path(Path::new(r"C:\exports\..\windows")).is_err());
            assert!(validate_output_path(Path::new(r"C:\exports\pawdio")).is_ok());
        }
        #[cfg(not(windows))]
        {
            assert!(validate_output_path(Path::new("/exports/../etc")).is_err());
            assert!(validate_output_path(Path::new("/exports/pawdio")).is_ok());
        }
    }

    #[test]
    fn export_filenames_lose_stream_and_device_names() {
        // The separator check in `write_text_export` lets these through, so the
        // sanitiser is what stops an invisible alternate-data-stream write and
        // a reserved Windows device name.
        assert_eq!(
            audio::sanitize_output_name("notes.txt:hidden"),
            "notes.txt_hidden"
        );
        assert_eq!(audio::sanitize_output_name("NUL.txt"), "_NUL.txt");
        assert_eq!(audio::sanitize_output_name("report.txt."), "report.txt");
        assert_eq!(audio::sanitize_output_name("sweep_1k.txt"), "sweep_1k.txt");
    }
}
