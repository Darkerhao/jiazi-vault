use crate::{
    crypto::Metadata,
    error::{Error, Result, ensure},
};
use rusqlite::{Connection, OptionalExtension, params, types::Value as SqlValue};
use serde_json::{Value, json};
use std::{fs, path::Path};

pub const TRASH_RETENTION: i64 = 30 * 24 * 60 * 60 * 1000;
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn open(directory: &Path) -> Result<Connection> {
    fs::create_dir_all(directory)?;
    let db = Connection::open(directory.join("vault.db"))?;
    db.execute_batch("PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS unlock_attempts (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, retry_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS vault_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL COLLATE NOCASE UNIQUE, icon TEXT, color TEXT, description TEXT, last_accessed_at INTEGER);
        CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT, environment TEXT, username TEXT, url TEXT, host TEXT, port INTEGER, tags TEXT NOT NULL DEFAULT '[]', secret TEXT NOT NULL, has_secret INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);")?;
    let columns = rows(&db, "PRAGMA table_info(items)", [])?;
    if !columns
        .iter()
        .any(|column| column["name"] == "last_accessed_at")
    {
        db.execute_batch("ALTER TABLE items ADD COLUMN last_accessed_at INTEGER;")?;
    }
    if !columns.iter().any(|column| column["name"] == "pinned") {
        db.execute_batch("ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;")?;
    }
    db.execute_batch("CREATE INDEX IF NOT EXISTS items_deleted_at ON items(deleted_at);
        CREATE TABLE IF NOT EXISTS item_history (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, saved_at INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS history_item ON item_history(item_id,id);
        CREATE TRIGGER IF NOT EXISTS backup_items_pinned_UPDATE AFTER UPDATE OF pinned ON items BEGIN INSERT INTO settings(key,value) VALUES('backup_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;
        INSERT OR IGNORE INTO settings (key,value) VALUES ('backup_revision','1');")?;
    for (table, columns) in [
        (
            "items",
            "type,title,project_id,environment,username,url,host,port,tags,secret,favorite,deleted_at",
        ),
        ("projects", "name,icon,color,description"),
        ("vault_metadata", "value"),
        ("settings", "value"),
    ] {
        for operation in ["INSERT", "UPDATE", "DELETE"] {
            let row = if operation == "DELETE" { "OLD" } else { "NEW" };
            let condition = match table {
                "settings" => format!("WHEN {row}.key='preferences'"),
                "vault_metadata" => format!("WHEN {row}.key='vault'"),
                _ => String::new(),
            };
            let action = if operation == "UPDATE" {
                format!("UPDATE OF {columns}")
            } else {
                operation.into()
            };
            db.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS backup_{table}_{operation} AFTER {action} ON {table} {condition} BEGIN INSERT INTO settings(key,value) VALUES('backup_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;"))?;
        }
    }
    purge(&db)?;
    Ok(db)
}

pub fn rows(db: &Connection, sql: &str, parameters: impl rusqlite::Params) -> Result<Vec<Value>> {
    let mut statement = db.prepare(sql)?;
    let names = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    let values = statement
        .query_map(parameters, |row| {
            let mut object = serde_json::Map::new();
            for (index, name) in names.iter().enumerate() {
                let value = match row.get::<_, SqlValue>(index)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(value) => json!(value),
                    SqlValue::Real(value) => json!(value),
                    SqlValue::Text(value) => json!(value),
                    SqlValue::Blob(_) => return Err(rusqlite::Error::InvalidQuery),
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(values)
}
pub fn setting(db: &Connection, key: &str) -> Result<Option<Value>> {
    let raw: Option<String> = db
        .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
            row.get(0)
        })
        .optional()?;
    raw.map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}
pub fn save_setting(db: &Connection, key: &str, value: &Value) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
        params![key, value.to_string()],
    )?;
    Ok(())
}
pub fn metadata(db: &Connection) -> Result<Option<Metadata>> {
    let raw: Option<String> = db
        .query_row(
            "SELECT value FROM vault_metadata WHERE key='vault'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    raw.map(|value| {
        let metadata: Metadata =
            serde_json::from_str(&value).map_err(|_| Error("DATABASE_ERROR"))?;
        metadata.validate().map_err(|_| Error("DATABASE_ERROR"))?;
        Ok(metadata)
    })
    .transpose()
}
pub fn revision(db: &Connection) -> Result<i64> {
    Ok(setting(db, "backup_revision")?
        .and_then(|value| value.as_i64())
        .unwrap_or(0))
}
pub fn backup_status(db: &Connection) -> Result<Value> {
    let record = setting(db, "backup_record")?.unwrap_or(Value::Null);
    Ok(
        json!({"lastBackupAt":record["at"], "hasChanges":record["revision"].as_i64()!=Some(revision(db)?)}),
    )
}
pub fn record_backup(db: &Connection, revision: i64) -> Result<()> {
    save_setting(
        db,
        "backup_record",
        &json!({"at":now(),"revision":revision}),
    )
}
pub fn purge(db: &Connection) -> Result<usize> {
    Ok(db.execute(
        "DELETE FROM items WHERE deleted_at<=?",
        [now() - TRASH_RETENTION],
    )?)
}
pub fn default_settings() -> Value {
    json!({"themeMode":"system","clipboardClearTimeout":15,"autoLockMinutes":15})
}
pub fn validate_settings(value: &Value) -> Result<Value> {
    ensure(
        [json!("system"), json!("light"), json!("dark")].contains(&value["themeMode"])
            && [
                json!("never"),
                json!(5),
                json!(10),
                json!(15),
                json!(30),
                json!(60),
            ]
            .contains(&value["clipboardClearTimeout"])
            && [Value::Null, json!(5), json!(15), json!(30), json!(60)]
                .contains(&value["autoLockMinutes"])
            && value.get("autoLockMinutes").is_some(),
        "INVALID_SETTINGS",
    )?;
    Ok(
        json!({"themeMode":value["themeMode"],"clipboardClearTimeout":value["clipboardClearTimeout"],"autoLockMinutes":value["autoLockMinutes"]}),
    )
}
pub fn settings(db: &Connection) -> Result<Value> {
    validate_settings(&setting(db, "preferences")?.unwrap_or_else(default_settings))
}
pub fn retry_at(db: &Connection) -> Result<i64> {
    let at: i64 = db
        .query_row(
            "SELECT retry_at FROM unlock_attempts WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    Ok(if at > now() { at } else { 0 })
}
pub fn fail_unlock(db: &Connection) -> Result<i64> {
    let count: i64 = db
        .query_row(
            "SELECT failures FROM unlock_attempts WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let count = (count + 1).min(10);
    let at = if count < 5 {
        0
    } else {
        now() + (30_000_i64 * 2_i64.pow((count - 5) as u32)).min(900_000)
    };
    db.execute(
        "INSERT OR REPLACE INTO unlock_attempts VALUES(1,?,?)",
        params![count, at],
    )?;
    Ok(at)
}
pub fn transaction<T>(db: &Connection, work: impl FnOnce() -> Result<T>) -> Result<T> {
    db.execute_batch("SAVEPOINT vault_operation")?;
    match work() {
        Ok(value) => {
            db.execute_batch("RELEASE vault_operation")?;
            Ok(value)
        }
        Err(error) => {
            db.execute_batch("ROLLBACK TO vault_operation; RELEASE vault_operation")?;
            Err(error)
        }
    }
}
pub fn sql_value(value: &Value) -> Result<SqlValue> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::String(v) => Ok(SqlValue::Text(v.clone())),
        Value::Number(v) if v.as_i64().is_some() => Ok(SqlValue::Integer(v.as_i64().unwrap())),
        _ => Err(Error("INVALID_DATA")),
    }
}
pub fn insert_rows(db: &Connection, table: &str, columns: &[&str], values: &[Value]) -> Result<()> {
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        columns.join(","),
        vec!["?"; columns.len()].join(",")
    );
    let mut statement = db.prepare(&sql)?;
    for row in values {
        let params = columns
            .iter()
            .map(|column| sql_value(&row[column]))
            .collect::<Result<Vec<_>>>()?;
        statement.execute(rusqlite::params_from_iter(params))?;
    }
    Ok(())
}
