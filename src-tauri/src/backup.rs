use crate::{
    crypto::{self, Metadata},
    database::{self as db, rows},
    error::{Error, Result, ensure},
    items,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_BYTES: u64 = 256 * 1024 * 1024;
const AUTOMATIC_BACKUP_INTERVAL_MS: i64 = 15 * 60 * 1000;
const ITEM_COLUMNS: &[&str] = &[
    "id",
    "type",
    "title",
    "project_id",
    "environment",
    "username",
    "url",
    "host",
    "port",
    "tags",
    "secret",
    "has_secret",
    "favorite",
    "pinned",
    "created_at",
    "updated_at",
    "deleted_at",
    "last_accessed_at",
];
const PROJECT_COLUMNS: &[&str] = &[
    "id",
    "name",
    "icon",
    "color",
    "description",
    "last_accessed_at",
];
#[derive(Clone, Serialize, Deserialize)]
pub struct Backup {
    pub metadata: Metadata,
    pub items: Vec<Value>,
    pub projects: Vec<Value>,
    pub settings: Value,
    pub history: Vec<Value>,
}

pub fn create(db: &Connection, key: &[u8; 32]) -> Result<String> {
    let metadata = db::metadata(db)?.ok_or(Error("VAULT_NOT_FOUND"))?;
    let payload = json!({"items":rows(db,"SELECT * FROM items ORDER BY id",[])?,"projects":rows(db,"SELECT * FROM projects ORDER BY id",[])?,"settings":db::settings(db)?,"history":rows(db,"SELECT * FROM item_history ORDER BY id",[])?});
    let encrypted: Value = serde_json::from_str(&crypto::encrypt(key, &payload.to_string())?)?;
    let output =
        json!({"format":"jiazi-vault","version":4,"metadata":metadata,"payload":encrypted})
            .to_string();
    ensure(output.len() as u64 <= MAX_BYTES, "BACKUP_TOO_LARGE")?;
    Ok(output)
}
fn safe_int(value: &Value) -> bool {
    value
        .as_i64()
        .is_some_and(|v| v.unsigned_abs() <= 9_007_199_254_740_991)
}
pub fn read(contents: &str, password: &str) -> Result<Backup> {
    ensure(contents.len() as u64 <= MAX_BYTES, "BACKUP_TOO_LARGE")?;
    read_inner(contents, password).map_err(|_| Error("BACKUP_PASSWORD_OR_DATA_INVALID"))
}
fn read_inner(contents: &str, password: &str) -> Result<Backup> {
    let envelope: Value = serde_json::from_str(contents)?;
    let version = envelope["version"]
        .as_u64()
        .ok_or(Error("INVALID_BACKUP"))?;
    ensure(
        envelope["format"] == "jiazi-vault" && (1..=4).contains(&version),
        "INVALID_BACKUP",
    )?;
    let metadata: Metadata = serde_json::from_value(envelope["metadata"].clone())?;
    let key = crypto::unlock(password, &metadata)?.ok_or(Error("INVALID_PASSWORD"))?;
    let payload: Value =
        serde_json::from_str(&crypto::decrypt(&key, &envelope["payload"].to_string())?)?;
    let mut items = payload["items"]
        .as_array()
        .ok_or(Error("INVALID_BACKUP"))?
        .clone();
    let mut ids = HashSet::new();
    for item in &mut items {
        ensure(item.is_object(), "INVALID_BACKUP")?;
        if version < 3 && item.get("last_accessed_at").is_none() {
            item["last_accessed_at"] = Value::Null
        }
        if item.get("pinned").is_none() {
            item["pinned"] = json!(0)
        }
        for name in ["id", "type", "title", "tags", "secret"] {
            ensure(item[name].is_string(), "INVALID_BACKUP")?
        }
        ensure(
            !item["id"].as_str().unwrap().is_empty()
                && ids.insert(item["id"].as_str().unwrap().to_owned()),
            "INVALID_BACKUP",
        )?;
        for name in ["project_id", "environment", "username", "url", "host"] {
            ensure(
                item.get(name).is_some() && (item[name].is_null() || item[name].is_string()),
                "INVALID_BACKUP",
            )?
        }
        for name in ["favorite", "pinned", "has_secret"] {
            ensure(item[name] == 0 || item[name] == 1, "INVALID_BACKUP")?
        }
        for name in ["created_at", "updated_at"] {
            ensure(safe_int(&item[name]), "INVALID_BACKUP")?
        }
        for name in ["deleted_at", "last_accessed_at"] {
            ensure(
                item.get(name).is_some() && (item[name].is_null() || safe_int(&item[name])),
                "INVALID_BACKUP",
            )?
        }
        ensure(
            item["last_accessed_at"].as_i64().is_none_or(|v| v >= 0),
            "INVALID_BACKUP",
        )?;
        ensure(
            item.get("port").is_some()
                && (item["port"].is_null() || item["port"].as_u64().is_some_and(|v| v <= 65535)),
            "INVALID_BACKUP",
        )?;
        let tags: Vec<String> = serde_json::from_str(item["tags"].as_str().unwrap())?;
        drop(tags);
        let value = items::from_row(item, &key)?;
        items::validate(&value, false)?;
        if version == 1 {
            item["project_id"] = Value::Null
        }
    }
    let projects = if version == 1 {
        ensure(payload.get("projects").is_none(), "INVALID_BACKUP")?;
        vec![]
    } else {
        payload["projects"]
            .as_array()
            .ok_or(Error("INVALID_BACKUP"))?
            .clone()
    };
    let mut project_ids = HashSet::new();
    let mut names = HashSet::new();
    for project in &projects {
        let id = project["id"].as_str().ok_or(Error("INVALID_BACKUP"))?;
        ensure(!id.is_empty() && project_ids.insert(id), "INVALID_BACKUP")?;
        ensure(
            project.get("last_accessed_at").is_some()
                && (project["last_accessed_at"].is_null()
                    || safe_int(&project["last_accessed_at"])),
            "INVALID_BACKUP",
        )?;
        let validated = items::validate_project(project)?;
        ensure(
            names.insert(validated["name"].as_str().unwrap().to_ascii_lowercase()),
            "INVALID_BACKUP",
        )?;
    }
    for item in &items {
        if let Some(id) = item["project_id"].as_str() {
            ensure(project_ids.contains(id), "INVALID_BACKUP")?
        }
    }
    let history = if version < 4 {
        vec![]
    } else {
        payload["history"]
            .as_array()
            .ok_or(Error("INVALID_BACKUP"))?
            .clone()
    };
    let mut history_ids = HashSet::new();
    let mut counts = HashMap::<String, usize>::new();
    for row in &history {
        let id = row["id"].as_i64().ok_or(Error("INVALID_BACKUP"))?;
        let item_id = row["item_id"].as_str().ok_or(Error("INVALID_BACKUP"))?;
        ensure(
            id > 0
                && safe_int(&row["id"])
                && history_ids.insert(id)
                && ids.contains(item_id)
                && safe_int(&row["saved_at"])
                && row["saved_at"].as_i64().unwrap() >= 0,
            "INVALID_BACKUP",
        )?;
        let item: items::Item = serde_json::from_str(&crypto::decrypt(
            &key,
            row["payload"].as_str().ok_or(Error("INVALID_BACKUP"))?,
        )?)?;
        ensure(item.id == item_id, "INVALID_BACKUP")?;
        items::validate(&item, false)?;
        let count = counts.entry(item_id.to_owned()).or_default();
        *count += 1;
        ensure(*count <= 20, "INVALID_BACKUP")?;
    }
    Ok(Backup {
        metadata,
        items,
        projects,
        settings: db::validate_settings(&payload["settings"])?,
        history,
    })
}
pub fn restore(db: &Connection, backup: &Backup) -> Result<()> {
    db::transaction(db,||{
        db.execute_batch("DELETE FROM items; DELETE FROM projects; DELETE FROM vault_metadata; DELETE FROM settings WHERE key NOT IN('automatic_backup','search-shortcut','desktop-preferences');")?;
        db.execute("INSERT INTO vault_metadata(key,value) VALUES('vault',?)",[serde_json::to_string(&backup.metadata)?])?;
        db::insert_rows(db,"projects",PROJECT_COLUMNS,&backup.projects)?;
        db::insert_rows(db,"items",ITEM_COLUMNS,&backup.items)?;
        db::insert_rows(db,"item_history",&["id","item_id","saved_at","payload"],&backup.history)?;
        db::save_setting(db,"preferences",&backup.settings)?;
        db::purge(db)?;
        Ok(())
    }).map_err(|_|Error("BACKUP_RESTORE_FAILED"))
}

/// Write to a private sibling, then atomically persist. Existing destinations survive partial writes.
pub fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    write_private_guarded(path, contents, || Ok(()))
}
pub fn write_private_guarded(
    path: &Path,
    contents: &[u8],
    validate: impl Fn() -> Result<()>,
) -> Result<()> {
    validate()?;
    let parent = path.parent().ok_or(Error("FILE_OPERATION_FAILED"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(contents)?;
    file.as_file().sync_all()?;
    validate()?;
    file.persist(path)
        .map_err(|_| Error("FILE_OPERATION_FAILED"))?;
    Ok(())
}
pub fn read_file(path: &Path, max: u64) -> Result<String> {
    use std::io::Read;
    ensure(fs::metadata(path)?.len() <= max, "BACKUP_TOO_LARGE")?;
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max + 1)
        .read_to_end(&mut bytes)?;
    ensure(bytes.len() as u64 <= max, "BACKUP_TOO_LARGE")?;
    String::from_utf8(bytes).map_err(|_| Error("INVALID_DATA"))
}
pub fn snapshot(db: &Connection, directory: &Path) -> Result<String> {
    let id = format!("snapshot-{}-{}.db", db::now(), Uuid::new_v4());
    let folder = directory.join("recovery");
    fs::create_dir_all(&folder)?;
    let path = folder.join(&id);
    db.execute(
        "VACUUM INTO ?",
        [path.to_str().ok_or(Error("RECOVERY_SNAPSHOT_FAILED"))?],
    )
    .map_err(|_| Error("RECOVERY_SNAPSHOT_FAILED"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(id)
}
fn snapshot_time(name: &str) -> Option<i64> {
    let tail = name.strip_prefix("snapshot-")?;
    let (stamp, id) = tail.split_once('-')?;
    if stamp.len() != 13 || Uuid::parse_str(id.strip_suffix(".db")?).is_err() {
        return None;
    }
    stamp.parse().ok()
}
pub fn snapshots(directory: &Path) -> Result<Vec<Value>> {
    let folder = directory.join("recovery");
    if !folder.exists() {
        return Ok(vec![]);
    }
    let mut values = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_file()
            && let Some(time) = snapshot_time(&name)
        {
            values.push(json!({"id":name,"createdAt":time}))
        }
    }
    values.sort_by_key(|value| std::cmp::Reverse(value["createdAt"].as_i64().unwrap_or(0)));
    Ok(values)
}
pub fn read_snapshot(directory: &Path, id: &str, password: &str) -> Result<Backup> {
    ensure(
        snapshots(directory)?
            .iter()
            .any(|snapshot| snapshot["id"] == id),
        "INVALID_SNAPSHOT",
    )?;
    let path = directory.join("recovery").join(id);
    ensure(fs::metadata(&path)?.len() <= MAX_BYTES, "BACKUP_TOO_LARGE")?;
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let metadata = db::metadata(&db)?.ok_or(Error("INVALID_BACKUP"))?;
    let key = crypto::unlock(password, &metadata)?.ok_or(Error("INVALID_PASSWORD"))?;
    read(&create(&db, &key)?, password)
}
pub fn recover(directory: &Path, backup: &Backup) -> Result<()> {
    let staging = tempfile::Builder::new()
        .prefix("restore-")
        .tempdir_in(directory)?;
    let prepared = db::open(staging.path())?;
    restore(&prepared, backup)?;
    drop(prepared);
    let preserved = directory.join("recovery").join(
        staging
            .path()
            .file_name()
            .ok_or(Error("BACKUP_RESTORE_FAILED"))?,
    );
    fs::create_dir_all(&preserved)?;
    let mut moved = Vec::new();
    let result = (|| {
        for name in [
            "vault.db",
            "vault.db-journal",
            "vault.db-wal",
            "vault.db-shm",
        ] {
            if directory.join(name).exists() {
                fs::rename(directory.join(name), preserved.join(name))?;
                moved.push(name);
            }
        }
        fs::rename(staging.path().join("vault.db"), directory.join("vault.db"))?;
        Ok(())
    })();
    if result.is_err() {
        for name in moved.into_iter().rev() {
            fs::rename(preserved.join(name), directory.join(name))?;
        }
    }
    result
}
pub fn automatic_status(db: &Connection) -> Result<Value> {
    let config = db::setting(db, "automatic_backup")?.unwrap_or(Value::Null);
    let record = db::setting(db, "automatic_backup_record")?.unwrap_or(Value::Null);
    let path = config["directory"].as_str().map(PathBuf::from);
    let exists = path
        .as_ref()
        .zip(record["file"].as_str())
        .is_some_and(|(path, file)| path.join(file).is_file());
    Ok(
        json!({"directory":config["directory"],"directoryAvailable":path.as_ref().is_some_and(|path| path.is_dir()),"lastBackupAt":record["at"],"fileExists":exists,"error":db::setting(db,"automatic_backup_error")?.is_some()}),
    )
}
pub fn automatic(db: &Connection, key: &[u8; 32], force: bool) -> Result<bool> {
    let config = db::setting(db, "automatic_backup")?.unwrap_or(Value::Null);
    let Some(directory) = config["directory"].as_str() else {
        return Ok(false);
    };
    let directory = Path::new(directory);
    let result = (|| {
        let record = db::setting(db, "automatic_backup_record")?.unwrap_or(Value::Null);
        let revision = db::revision(db)?;
        if !force {
            let file_exists = record["file"]
                .as_str()
                .is_some_and(|file| directory.join(file).is_file());
            if file_exists {
                if record["revision"].as_i64() == Some(revision) {
                    return Ok(false);
                }
                let elapsed = db::now().saturating_sub(record["at"].as_i64().unwrap_or(0));
                if elapsed < AUTOMATIC_BACKUP_INTERVAL_MS {
                    return Ok(false);
                }
            }
        }
        let at = db::now();
        let name = format!("auto-{at}-{}.jvault", Uuid::new_v4());
        write_private(&directory.join(&name), create(db, key)?.as_bytes())?;
        db::save_setting(
            db,
            "automatic_backup_record",
            &json!({"at":at,"revision":revision,"file":name}),
        )?;
        db::record_backup(db, revision)?;
        let mut files = fs::read_dir(directory)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_ok_and(|v| v.is_file()))
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                let test = name.replace("auto-", "snapshot-").replace(".jvault", ".db");
                snapshot_time(&test).map(|_| (name, entry.path()))
            })
            .collect::<Vec<_>>();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in files.into_iter().skip(10) {
            fs::remove_file(path)?;
        }
        db.execute(
            "DELETE FROM settings WHERE key='automatic_backup_error'",
            [],
        )?;
        Ok(true)
    })();
    if result.is_err() {
        db::save_setting(db, "automatic_backup_error", &json!(1))?;
    }
    result
}
