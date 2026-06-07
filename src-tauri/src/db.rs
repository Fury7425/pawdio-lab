//! SQLite-backed measurement library.
//!
//! Persists measurement results per device so the UI can keep a history and
//! compare audio devices across sessions. The connection is held in
//! `AppState` (see `main.rs`) behind a `tokio::sync::Mutex`, mirroring how the
//! `AudioEngine` is shared. These functions operate on a borrowed `Connection`;
//! the thin `#[tauri::command]` wrappers in `main.rs` lock the mutex and call in.
//!
//! Large numeric arrays (FR/ANC curves) are stored whole as a JSON `TEXT`
//! column (`payload_json`); only metadata columns are ever queried.

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Bumped when the on-disk schema changes in a way that needs a migration.
const DB_VERSION: i64 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub id: i64,
    pub name: String,
    pub kind: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementSummary {
    pub id: i64,
    pub device_id: i64,
    pub test_type: String,
    pub captured_at: i64,
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementRecord {
    pub id: i64,
    pub device_id: i64,
    pub test_type: String,
    pub captured_at: i64,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub schema_ver: i64,
    pub payload: Value,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Open (creating if needed) the database at `db_path` and ensure the schema.
pub fn init(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create db directory: {e}"))?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    configure(&conn)?;
    Ok(conn)
}

/// Enable foreign keys (off by default in SQLite — required for cascade delete)
/// and create the tables/indexes if they don't exist.
fn configure(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS devices (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             name        TEXT    NOT NULL,
             kind        TEXT,
             notes       TEXT,
             created_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS measurements (
             id           INTEGER PRIMARY KEY AUTOINCREMENT,
             device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
             test_type    TEXT    NOT NULL,
             captured_at  INTEGER NOT NULL,
             label        TEXT,
             notes        TEXT,
             payload_json TEXT    NOT NULL,
             schema_ver   INTEGER NOT NULL DEFAULT 1
         );
         CREATE INDEX IF NOT EXISTS idx_meas_device ON measurements(device_id);
         CREATE INDEX IF NOT EXISTS idx_meas_type   ON measurements(test_type);
         CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO meta (key, value) VALUES ('db_version', ?1)",
        params![DB_VERSION.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn map_device(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeviceRecord> {
    Ok(DeviceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        notes: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn list_devices(conn: &Connection) -> Result<Vec<DeviceRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, kind, notes, created_at FROM devices ORDER BY created_at DESC, id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_device)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn get_device(conn: &Connection, id: i64) -> Result<DeviceRecord, String> {
    conn.query_row(
        "SELECT id, name, kind, notes, created_at FROM devices WHERE id = ?1",
        params![id],
        map_device,
    )
    .map_err(|e| e.to_string())
}

pub fn create_device(
    conn: &Connection,
    name: &str,
    kind: Option<String>,
) -> Result<DeviceRecord, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("device name cannot be empty".to_string());
    }
    let created_at = now_millis();
    conn.execute(
        "INSERT INTO devices (name, kind, notes, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![trimmed, kind, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(DeviceRecord {
        id: conn.last_insert_rowid(),
        name: trimmed.to_string(),
        kind,
        notes: None,
        created_at,
    })
}

pub fn rename_device(conn: &Connection, id: i64, name: &str) -> Result<DeviceRecord, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("device name cannot be empty".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE devices SET name = ?1 WHERE id = ?2",
            params![trimmed, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("device {id} not found"));
    }
    get_device(conn, id)
}

/// Delete a device and (via `ON DELETE CASCADE` + `PRAGMA foreign_keys = ON`)
/// all of its measurements.
pub fn delete_device(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM devices WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_measurements(
    conn: &Connection,
    device_id: Option<i64>,
    test_type: Option<String>,
) -> Result<Vec<MeasurementSummary>, String> {
    let mut sql =
        String::from("SELECT id, device_id, test_type, captured_at, label FROM measurements WHERE 1=1");
    let mut binds: Vec<SqlValue> = Vec::new();
    if let Some(d) = device_id {
        sql.push_str(" AND device_id = ?");
        binds.push(SqlValue::Integer(d));
    }
    if let Some(t) = test_type {
        sql.push_str(" AND test_type = ?");
        binds.push(SqlValue::Text(t));
    }
    sql.push_str(" ORDER BY captured_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(binds.iter()), |row| {
            Ok(MeasurementSummary {
                id: row.get(0)?,
                device_id: row.get(1)?,
                test_type: row.get(2)?,
                captured_at: row.get(3)?,
                label: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_measurement(conn: &Connection, id: i64) -> Result<MeasurementRecord, String> {
    let (device_id, test_type, captured_at, label, notes, payload_json, schema_ver): (
        i64,
        String,
        i64,
        Option<String>,
        Option<String>,
        String,
        i64,
    ) = conn
        .query_row(
            "SELECT device_id, test_type, captured_at, label, notes, payload_json, schema_ver
             FROM measurements WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let payload: Value = serde_json::from_str(&payload_json).map_err(|e| e.to_string())?;
    Ok(MeasurementRecord {
        id,
        device_id,
        test_type,
        captured_at,
        label,
        notes,
        schema_ver,
        payload,
    })
}

pub fn save_measurement(
    conn: &Connection,
    device_id: i64,
    test_type: &str,
    label: Option<String>,
    payload: &Value,
) -> Result<MeasurementRecord, String> {
    let captured_at = now_millis();
    let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO measurements
            (device_id, test_type, captured_at, label, notes, payload_json, schema_ver)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)",
        params![device_id, test_type, captured_at, label, payload_json, DB_VERSION],
    )
    .map_err(|e| e.to_string())?;
    Ok(MeasurementRecord {
        id: conn.last_insert_rowid(),
        device_id,
        test_type: test_type.to_string(),
        captured_at,
        label,
        notes: None,
        schema_ver: DB_VERSION,
        payload: payload.clone(),
    })
}

pub fn delete_measurement(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM measurements WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn
    }

    #[test]
    fn insert_list_get_then_cascade_delete() {
        let conn = mem();
        let dev = create_device(&conn, "Device A", Some("earbuds".into())).unwrap();
        assert!(dev.id > 0);

        let payload = serde_json::json!({ "test": "latency", "averageDelayMs": 12.5 });
        let rec = save_measurement(&conn, dev.id, "latency", Some("run 1".into()), &payload).unwrap();
        assert_eq!(rec.device_id, dev.id);

        let summaries = list_measurements(&conn, Some(dev.id), None).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].test_type, "latency");

        let fetched = get_measurement(&conn, rec.id).unwrap();
        assert_eq!(fetched.payload["averageDelayMs"], 12.5);

        // Cascade: deleting the device removes its measurements.
        delete_device(&conn, dev.id).unwrap();
        assert!(list_devices(&conn).unwrap().is_empty());
        assert!(list_measurements(&conn, None, None).unwrap().is_empty());
    }

    #[test]
    fn filter_by_test_type_and_rename() {
        let conn = mem();
        let dev = create_device(&conn, "Device B", None).unwrap();
        save_measurement(&conn, dev.id, "sweep_fr", None, &serde_json::json!({})).unwrap();
        save_measurement(&conn, dev.id, "anc", None, &serde_json::json!({})).unwrap();

        let only_anc = list_measurements(&conn, None, Some("anc".into())).unwrap();
        assert_eq!(only_anc.len(), 1);

        let renamed = rename_device(&conn, dev.id, "Device B2").unwrap();
        assert_eq!(renamed.name, "Device B2");
    }
}
