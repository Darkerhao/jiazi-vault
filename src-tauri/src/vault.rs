use crate::{
    backup::{self, Backup},
    crypto::{self, Key},
    database::{self as db, rows},
    error::{Error, Result, ensure},
    items::{self, Item},
    transfer::{self, Record},
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub struct PendingImport {
    pub token: String,
    pub epoch: u64,
    pub name: String,
    pub records: Option<Vec<Record>>,
    pub csv: Option<transfer::CsvSource>,
}
pub struct PendingRestore {
    pub token: String,
    pub epoch: u64,
    pub name: String,
    pub path: Option<PathBuf>,
    pub snapshot_id: Option<String>,
    pub backup: Option<Backup>,
}
pub struct Vault {
    pub directory: PathBuf,
    pub db: Option<Connection>,
    pub epoch: Arc<AtomicU64>,
    key: Option<Key>,
    key_epoch: u64,
    pub last_activity: Instant,
    pub pending_import: Option<PendingImport>,
    pub pending_restore: Option<PendingRestore>,
    pub owned_clipboard: Option<Zeroizing<String>>,
    pub copied_at: Instant,
}
pub fn text<'a>(args: &'a Value, name: &str) -> Result<&'a str> {
    args[name].as_str().ok_or(Error("INVALID_DATA"))
}
pub fn password(args: &Value, name: &str) -> Result<Zeroizing<String>> {
    let value = text(args, name)?;
    ensure(value.encode_utf16().count() >= 8, "PASSWORD_TOO_SHORT")?;
    Ok(Zeroizing::new(value.to_owned()))
}
pub fn id() -> String {
    Uuid::new_v4().to_string()
}

impl Vault {
    pub fn prepare_import(&mut self, name: String, contents: &str, format: &str) -> Result<Value> {
        let epoch = self.generation();
        self.key()?;
        self.pending_import = None;
        let csv = if format == "csv" {
            Some(transfer::CsvSource::parse(contents)?)
        } else {
            None
        };
        let records = if let Some(csv) = &csv {
            if csv.native_format() {
                Some(csv.records(None)?)
            } else {
                None
            }
        } else {
            Some(transfer::parse(contents, format)?)
        };
        let mut result = if let Some(records) = &records {
            transfer::preview(self.connection()?, self.key()?, records)?
        } else {
            let csv = csv.as_ref().ok_or(Error("INVALID_IMPORT"))?;
            json!({"columns":csv.headers,"rowCount":csv.rows.len()})
        };
        let token = id();
        result["token"] = json!(token);
        result["name"] = json!(name);
        self.pending_import = Some(PendingImport {
            token,
            epoch,
            name,
            records,
            csv,
        });
        Ok(result)
    }
    pub fn new(directory: PathBuf, epoch: Arc<AtomicU64>) -> Self {
        let opened = db::open(&directory)
            .and_then(|db| {
                db::settings(&db)?;
                Ok(db)
            })
            .ok();
        Self {
            directory,
            db: opened,
            epoch,
            key: None,
            key_epoch: 0,
            last_activity: Instant::now(),
            pending_import: None,
            pending_restore: None,
            owned_clipboard: None,
            copied_at: Instant::now(),
        }
    }
    pub fn connection(&self) -> Result<&Connection> {
        self.db.as_ref().ok_or(Error("DATABASE_ERROR"))
    }
    pub fn settings(&self) -> Value {
        self.db
            .as_ref()
            .and_then(|db| db::settings(db).ok())
            .unwrap_or_else(db::default_settings)
    }
    pub fn generation(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }
    pub fn active(&self) -> bool {
        self.key.is_some()
            && self.key_epoch == self.generation()
            && self.settings()["autoLockMinutes"]
                .as_u64()
                .is_none_or(|minutes| self.last_activity.elapsed().as_secs() < minutes * 60)
    }
    pub fn key(&self) -> Result<&[u8; 32]> {
        ensure(self.active(), "VAULT_LOCKED")?;
        self.key.as_deref().ok_or(Error("VAULT_LOCKED"))
    }
    pub fn check_epoch(&self, epoch: u64) -> Result<()> {
        ensure(
            self.generation() == epoch && (!self.has_key() || self.active()),
            "VAULT_LOCKED",
        )
    }
    pub fn lock(&mut self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.key.take();
        self.pending_import = None;
        self.pending_restore = None;
    }
    pub fn has_key(&self) -> bool {
        self.key.is_some()
    }
    pub fn touch(&mut self) {
        if self.active() {
            self.last_activity = Instant::now()
        }
    }
    pub fn adopt(&mut self, key: Key, epoch: u64) -> Result<()> {
        self.check_epoch(epoch)?;
        self.key = Some(key);
        self.key_epoch = epoch;
        self.last_activity = Instant::now();
        Ok(())
    }
    pub fn verify_password(&self, value: &str) -> Result<Key> {
        let db = self.connection()?;
        ensure(db::retry_at(db)? == 0, "UNLOCK_RATE_LIMITED")?;
        let metadata = db::metadata(db)?.ok_or(Error("VAULT_NOT_FOUND"))?;
        match crypto::unlock(value, &metadata)? {
            Some(key) => Ok(key),
            None => {
                db::fail_unlock(db)?;
                Err(Error("INVALID_PASSWORD"))
            }
        }
    }
    pub fn automatic_backup(&self, force: bool) -> Result<bool> {
        if !self.active() {
            return Ok(false);
        }
        backup::automatic(self.connection()?, self.key()?, force)
    }
    pub fn call(&mut self, command: &str, args: &Value) -> Result<Value> {
        match command {
            "health_check" => return Ok(json!("ok")),
            "touch_session" => {
                self.touch();
                return Ok(Value::Null);
            }
            "lock_vault" => {
                self.lock();
                return Ok(Value::Null);
            }
            "get_vault_status" => {
                return Ok(
                    json!({"exists":self.db.as_ref().map(db::metadata).transpose()?.flatten().is_some(),"unlocked":self.active(),"retryAt":self.db.as_ref().map(db::retry_at).transpose()?.unwrap_or(0),"databaseError":self.db.is_none()}),
                );
            }
            "is_vault_unlocked" => return Ok(json!(self.active())),
            "get_settings" => return Ok(self.settings()),
            "database_info" => {
                self.connection()?;
                return Ok(json!({"initialized":true,"path":self.directory.join("vault.db")}));
            }
            "list_recovery_snapshots" => return Ok(json!(backup::snapshots(&self.directory)?)),
            "create_vault" => {
                let password = password(args, "password")?;
                let epoch = self.generation();
                ensure(db::metadata(self.connection()?)?.is_none(), "VAULT_EXISTS")?;
                let (metadata, key) = crypto::create(&password)?;
                self.check_epoch(epoch)?;
                self.connection()?.execute(
                    "INSERT INTO vault_metadata(key,value) VALUES('vault',?)",
                    [serde_json::to_string(&metadata)?],
                )?;
                self.adopt(key, epoch)?;
                return Ok(Value::Null);
            }
            "unlock_vault" => {
                let value = Zeroizing::new(text(args, "password")?.to_owned());
                let epoch = self.generation();
                let db = self.connection()?;
                let retry = db::retry_at(db)?;
                if retry > 0 {
                    return Ok(json!({"unlocked":false,"retryAt":retry}));
                }
                let metadata = db::metadata(db)?.ok_or(Error("VAULT_NOT_FOUND"))?;
                let key = if value.encode_utf16().count() < 8 {
                    None
                } else {
                    crypto::unlock(&value, &metadata)?
                };
                self.check_epoch(epoch)?;
                if let Some(key) = key {
                    self.connection()?
                        .execute("DELETE FROM unlock_attempts", [])?;
                    self.adopt(key, epoch)?;
                    return Ok(json!({"unlocked":true,"retryAt":0}));
                }
                return Ok(
                    json!({"unlocked":false,"retryAt":db::fail_unlock(self.connection()?)?}),
                );
            }
            "cancel_backup_restore" => {
                if self
                    .pending_restore
                    .as_ref()
                    .is_some_and(|source| source.token == args["token"])
                {
                    self.pending_restore = None
                }
                return Ok(Value::Null);
            }
            "preview_backup" => {
                let password = password(args, "password")?;
                ensure(
                    self.pending_restore
                        .as_ref()
                        .is_some_and(|source| source.token == args["token"]),
                    "INVALID_BACKUP_PREVIEW",
                )?;
                self.pending_restore.as_mut().unwrap().backup = None;
                let source = self
                    .pending_restore
                    .as_ref()
                    .filter(|source| source.token == args["token"])
                    .ok_or(Error("INVALID_BACKUP_PREVIEW"))?;
                self.check_epoch(source.epoch)?;
                let backup = if let Some(id) = &source.snapshot_id {
                    backup::read_snapshot(&self.directory, id, &password)?
                } else {
                    backup::read(
                        &backup::read_file(
                            source
                                .path
                                .as_ref()
                                .ok_or(Error("INVALID_BACKUP_PREVIEW"))?,
                            backup::MAX_BYTES,
                        )?,
                        &password,
                    )?
                };
                self.check_epoch(source.epoch)?;
                let trashed = backup
                    .items
                    .iter()
                    .filter(|item| !item["deleted_at"].is_null())
                    .count();
                let result = json!({"token":source.token,"name":source.name,"itemCount":backup.items.len()-trashed,"trashedCount":trashed,"projectCount":backup.projects.len(),"historyCount":backup.history.len()});
                self.pending_restore.as_mut().unwrap().backup = Some(backup);
                return Ok(result);
            }
            "restore_backup" => {
                let source = self
                    .pending_restore
                    .take()
                    .filter(|source| source.token == args["token"])
                    .ok_or(Error("INVALID_BACKUP_PREVIEW"))?;
                self.check_epoch(source.epoch)?;
                let backup = source.backup.ok_or(Error("INVALID_BACKUP_PREVIEW"))?;
                if let Some(db) = &self.db {
                    if db::metadata(db)?.is_some() {
                        backup::snapshot(db, &self.directory)?;
                    }
                    backup::restore(db, &backup)?;
                } else {
                    backup::recover(&self.directory, &backup)?;
                    self.db = Some(db::open(&self.directory)?);
                }
                self.connection()?
                    .execute("DELETE FROM unlock_attempts", [])?;
                self.lock();
                return Ok(json!(true));
            }
            _ => {}
        }
        let db = self.connection()?;
        let key = self.key()?;
        match command {
            "change_master_password" => {
                let old = password(args, "currentPassword")?;
                let new = password(args, "newPassword")?;
                ensure(*old != *new, "PASSWORD_UNCHANGED")?;
                let epoch = self.generation();
                let _verified = self.verify_password(&old)?;
                let (metadata, new_key) = crypto::create(&new)?;
                self.check_epoch(epoch)?;
                db::transaction(db,||{
                    for row in rows(db,"SELECT id,secret FROM items",[])? {
                        let value=crypto::decrypt(key,row["secret"].as_str().ok_or(Error("DECRYPT_FAILED"))?)?;
                        db.execute("UPDATE items SET secret=? WHERE id=?",params![crypto::encrypt(&new_key,&value)?,row["id"].as_str()])?;
                    }
                    for row in rows(db,"SELECT id,payload FROM item_history",[])? {
                        let value=crypto::decrypt(key,row["payload"].as_str().ok_or(Error("DECRYPT_FAILED"))?)?;
                        db.execute("UPDATE item_history SET payload=? WHERE id=?",params![crypto::encrypt(&new_key,&value)?,row["id"].as_i64()])?;
                    }
                    db.execute("UPDATE vault_metadata SET value=? WHERE key='vault'",[serde_json::to_string(&metadata)?])?;
                    db.execute_batch("DELETE FROM vault_metadata WHERE key IN('biometric','biometric-preferred','biometric-rust'); DELETE FROM unlock_attempts;")?;Ok(())
                }).map_err(|_|Error("PASSWORD_CHANGE_FAILED"))?;
                self.lock();
                Ok(Value::Null)
            }
            "update_settings" => {
                let value = db::validate_settings(&args["settings"])?;
                db::save_setting(db, "preferences", &value)?;
                Ok(value)
            }
            "list_items" => {
                db::purge(db)?;
                Ok(json!(items::list(
                    db,
                    key,
                    args["trashed"].as_bool().unwrap_or(false)
                )?))
            }
            "get_item" => {
                db::purge(db)?;
                Ok(serde_json::to_value(items::get(
                    db,
                    key,
                    text(args, "id")?,
                    args["recordAccess"].as_bool().unwrap_or(true),
                )?)?)
            }
            "create_item" => items::create(
                db,
                key,
                &serde_json::from_value::<Item>(args["item"].clone())?,
            ),
            "update_item" => items::update(
                db,
                key,
                &serde_json::from_value::<Item>(args["item"].clone())?,
            ),
            "toggle_favorite" => {
                let id = text(args, "id")?;
                db.execute("UPDATE items SET favorite=CASE favorite WHEN 1 THEN 0 ELSE 1 END,updated_at=? WHERE id=?",params![db::now(),id])?;
                items::summary(&items::raw(db, id)?, key)
            }
            "toggle_pin" => {
                let id = text(args, "id")?;
                db.execute("UPDATE items SET pinned=CASE pinned WHEN 1 THEN 0 ELSE 1 END,updated_at=? WHERE id=?",params![db::now(),id])?;
                items::summary(&items::raw(db, id)?, key)
            }
            "delete_item" => {
                let id = text(args, "id")?;
                if args["permanently"].as_bool().unwrap_or(false) {
                    db.execute("DELETE FROM items WHERE id=?", [id])?;
                } else {
                    db.execute(
                        "UPDATE items SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
                        params![db::now(), id],
                    )?;
                }
                Ok(Value::Null)
            }
            "restore_item" => {
                let id = text(args, "id")?;
                items::raw(db, id)?;
                db.execute("UPDATE items SET deleted_at=NULL WHERE id=?", [id])?;
                Ok(Value::Null)
            }
            "batch_items" => {
                let ids: Vec<String> = serde_json::from_value(args["ids"].clone())?;
                Ok(json!(items::batch(db, key, &ids, &args["action"])?))
            }
            "list_item_history" => Ok(json!(rows(
                db,
                "SELECT id,saved_at AS savedAt FROM item_history WHERE item_id=? ORDER BY id DESC",
                [text(args, "id")?]
            )?)),
            "get_item_history" | "restore_item_history" => {
                let id = text(args, "id")?;
                let history_id = args["historyId"].as_i64().ok_or(Error("INVALID_DATA"))?;
                let mut item = items::get_history(db, key, id, history_id)?;
                if command == "get_item_history" {
                    return Ok(serde_json::to_value(item)?);
                }
                if let Some(project) = &item.project_id
                    && rows(db, "SELECT id FROM projects WHERE id=?", [project])?.is_empty()
                {
                    item.project_id = None
                }
                item.id = id.into();
                items::update(db, key, &item)
            }
            "get_credential_health" => items::health(db, key),
            "list_projects" => Ok(json!(items::projects(db)?)),
            "create_project" | "update_project" => {
                items::save_project(db, &args["project"], command == "update_project")
            }
            "visit_project" => {
                let id = text(args, "id")?;
                db.execute(
                    "UPDATE projects SET last_accessed_at=? WHERE id=?",
                    params![db::now(), id],
                )?;
                items::projects(db)?
                    .into_iter()
                    .find(|p| p["id"] == id)
                    .ok_or(Error("PROJECT_NOT_FOUND"))
            }
            "delete_project" => {
                let id = text(args, "id")?;
                ensure(
                    !rows(db, "SELECT id FROM projects WHERE id=?", [id])?.is_empty(),
                    "PROJECT_NOT_FOUND",
                )?;
                db::transaction(db, || {
                    db.execute("UPDATE items SET project_id=NULL WHERE project_id=?", [id])?;
                    db.execute("DELETE FROM projects WHERE id=?", [id])?;
                    Ok(Value::Null)
                })
            }
            "generate_password" => generate_password(args),
            "get_backup_status" => db::backup_status(db),
            "get_automatic_backup_status" => backup::automatic_status(db),
            "run_automatic_backup" => {
                self.automatic_backup(true)?;
                Ok(Value::Null)
            }
            "map_import" => {
                let pending = self
                    .pending_import
                    .as_ref()
                    .filter(|pending| pending.token == args["token"])
                    .ok_or(Error("IMPORT_EXPIRED"))?;
                self.check_epoch(pending.epoch)?;
                let csv = pending.csv.as_ref().ok_or(Error("INVALID_MAPPING"))?;
                let records = csv.records(Some(&args["mapping"]))?;
                let mut preview = transfer::preview(db, key, &records)?;
                preview["token"] = json!(pending.token);
                preview["name"] = json!(pending.name);
                self.pending_import.as_mut().unwrap().records = Some(records);
                Ok(preview)
            }
            "confirm_import" => {
                let pending = self
                    .pending_import
                    .as_ref()
                    .filter(|pending| pending.token == args["token"])
                    .ok_or(Error("IMPORT_EXPIRED"))?;
                self.check_epoch(pending.epoch)?;
                let skip = args["skipDuplicates"]
                    .as_bool()
                    .ok_or(Error("INVALID_DATA"))?;
                let records = pending
                    .records
                    .as_ref()
                    .ok_or(Error("IMPORT_MAPPING_REQUIRED"))?;
                let result = transfer::import(db, key, records, skip)?;
                self.pending_import = None;
                Ok(json!(result))
            }
            "cancel_import" => {
                if self
                    .pending_import
                    .as_ref()
                    .is_some_and(|pending| pending.token == args["token"])
                {
                    self.pending_import = None
                }
                Ok(Value::Null)
            }
            _ => Err(Error("INVALID_COMMAND")),
        }
    }
}

pub fn generate_password(options: &Value) -> Result<Value> {
    let options = db::validate_generator_options(options)?;
    let length = options["length"].as_u64().unwrap() as usize;
    let mut groups = Vec::new();
    for (name, characters) in [
        ("uppercase", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
        ("lowercase", "abcdefghijklmnopqrstuvwxyz"),
        ("numbers", "0123456789"),
        ("symbols", "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
    ] {
        if options[name] == true {
            groups.push(
                characters
                    .bytes()
                    .filter(|ch| options["excludeAmbiguous"] != true || !b"0O1Il|".contains(ch))
                    .collect::<Vec<_>>(),
            );
        }
    }
    ensure(!groups.is_empty(), "INVALID_GENERATOR_OPTIONS")?;
    let alphabet = groups.concat();
    let size = alphabet.len() as u64;
    let limit = (u32::MAX as u64 + 1) / size * size;
    let password = loop {
        let mut bytes = Vec::with_capacity(length);
        while bytes.len() < length {
            let n = u32::from_le_bytes(crypto::random::<4>()?) as u64;
            if n < limit {
                bytes.push(alphabet[(n % size) as usize]);
            }
        }
        if groups
            .iter()
            .all(|group| bytes.iter().any(|ch| group.contains(ch)))
        {
            break String::from_utf8(bytes).map_err(|_| Error("RANDOM_FAILED"))?;
        }
    };
    let mut fraction = 0.0_f64;
    for mask in 0..(1_usize << groups.len()) {
        let excluded = groups
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, group)| group.len())
            .sum::<usize>();
        fraction += if mask.count_ones() % 2 == 0 {
            1.0
        } else {
            -1.0
        } * ((alphabet.len() - excluded) as f64 / alphabet.len() as f64)
            .powi(length as i32);
    }
    let entropy = length as f64 * (alphabet.len() as f64).log2() + fraction.log2();
    Ok(
        json!({"password":password,"entropy":entropy,"strength":if entropy<40.0{"弱"}else if entropy<60.0{"一般"}else if entropy<80.0{"强"}else{"非常强"}}),
    )
}
