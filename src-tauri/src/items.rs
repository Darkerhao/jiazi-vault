use crate::{
    crypto,
    database::{now, rows, transaction},
    error::{Error, Result, ensure},
};
use chrono::{Days, Local, NaiveDate};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use uuid::Uuid;

pub const TYPES: &[&str] = &[
    "login",
    "password",
    "server",
    "database",
    "api-key",
    "ssh",
    "secure-note",
    "custom",
    "env",
];
pub const ENVIRONMENTS: &[&str] = &["development", "testing", "staging", "production", "other"];
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(default)]
    pub id: String,
    pub r#type: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
}
pub fn valid_date(value: &str) -> bool {
    value.len() == 10
        && NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == value)
}
pub fn env_name(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().enumerate().all(|(index, ch)| {
            ch == b'_' || ch.is_ascii_alphabetic() || index > 0 && ch.is_ascii_digit()
        })
}
pub fn validate_env(fields: &BTreeMap<String, String>) -> Result<()> {
    ensure(
        !fields.is_empty() && fields.keys().all(|key| env_name(key)),
        "INVALID_ENV_FIELDS",
    )
}
pub fn serialize_env(fields: &BTreeMap<String, String>) -> Result<String> {
    validate_env(fields)?;
    let mut output = String::new();
    for (key, value) in fields {
        ensure(!value.contains(['\r', '\0']), "ENV_EXPORT_FAILED")?;
        let encoded = if value == value.trim()
            && !value.contains(['\n', '#'])
            && !value.starts_with(['\'', '"', '`'])
        {
            value.clone()
        } else if !value.contains('\'') {
            format!("'{value}'")
        } else if !value.contains('"') && !value.contains("\\n") {
            format!("\"{value}\"")
        } else {
            return Err(Error("ENV_EXPORT_FAILED"));
        };
        output.push_str(&format!("{key}={encoded}\n"));
    }
    Ok(output)
}

pub fn primary(item: &Item) -> Option<String> {
    let field = |key: &str| {
        item.fields
            .as_ref()
            .and_then(|fields| fields.get(key))
            .filter(|value| !value.is_empty())
            .cloned()
    };
    let password = || item.password.clone().filter(|value| !value.is_empty());
    match item.r#type.as_str() {
        "api-key" => field("apiKey").or_else(|| field("secret")),
        "ssh" => field("privateKey"),
        "secure-note" => item.notes.clone().filter(|value| !value.is_empty()),
        "database" => password().or_else(|| field("connectionString")),
        "custom" => password().or_else(|| {
            item.fields
                .as_ref()
                .and_then(|fields| fields.values().find(|value| !value.is_empty()).cloned())
        }),
        "env" => None,
        _ => password(),
    }
}

pub fn validate(item: &Item, check_expiry: bool) -> Result<()> {
    ensure(
        !item.title.trim().is_empty()
            && TYPES.contains(&item.r#type.as_str())
            && item
                .environment
                .as_deref()
                .is_none_or(|value| ENVIRONMENTS.contains(&value)),
        "INVALID_DATA",
    )?;
    if check_expiry
        && item.r#type == "api-key"
        && let Some(value) = item
            .fields
            .as_ref()
            .and_then(|fields| fields.get("expiresAt"))
            .filter(|value| !value.is_empty())
    {
        ensure(valid_date(value), "INVALID_EXPIRY")?;
    }
    if item.r#type == "env" {
        ensure(item.environment.is_some(), "ENVIRONMENT_REQUIRED")?;
        validate_env(item.fields.as_ref().ok_or(Error("INVALID_ENV_FIELDS"))?)?;
    }
    Ok(())
}
fn validate_project_id(db: &Connection, item: &Item) -> Result<()> {
    validate(item, true)?;
    if let Some(id) = item.project_id.as_deref().filter(|id| !id.is_empty()) {
        ensure(
            !rows(db, "SELECT id FROM projects WHERE id=?", [id])?.is_empty(),
            "PROJECT_NOT_FOUND",
        )?;
    }
    Ok(())
}
fn secret(item: &Item, key: &[u8; 32]) -> Result<(String, bool)> {
    let mut value = json!({});
    if let Some(password) = item.password.as_ref().filter(|v| !v.is_empty()) {
        value["password"] = json!(password)
    }
    if let Some(notes) = item.notes.as_ref().filter(|v| !v.is_empty()) {
        value["notes"] = json!(notes)
    }
    if let Some(fields) = item.fields.as_ref().filter(|v| !v.is_empty()) {
        value["fields"] = json!(fields)
    }
    let sensitive = value.get("password").is_some()
        || value.get("notes").is_some()
        || item
            .fields
            .as_ref()
            .is_some_and(|fields| fields.values().any(|v| !v.is_empty()));
    Ok((crypto::encrypt(key, &value.to_string())?, sensitive))
}
fn base(row: &Value) -> Result<Value> {
    let mut value = json!({});
    for (source, target) in [
        ("id", "id"),
        ("type", "type"),
        ("title", "title"),
        ("project_id", "projectId"),
        ("environment", "environment"),
        ("username", "username"),
        ("url", "url"),
        ("host", "host"),
        ("port", "port"),
        ("created_at", "createdAt"),
        ("updated_at", "updatedAt"),
        ("last_accessed_at", "lastAccessedAt"),
        ("deleted_at", "deletedAt"),
    ] {
        if !row[source].is_null() {
            value[target] = row[source].clone()
        }
    }
    value["favorite"] = json!(row["favorite"] == 1);
    value["pinned"] = json!(row["pinned"] == 1);
    let tags: Value = serde_json::from_str(row["tags"].as_str().unwrap_or("[]"))?;
    if tags.as_array().is_some_and(|values| !values.is_empty()) {
        value["tags"] = tags
    }
    Ok(value)
}
pub fn from_row(row: &Value, key: &[u8; 32]) -> Result<Item> {
    let mut value = base(row)?;
    let secret = row["secret"].as_str().ok_or(Error("DECRYPT_FAILED"))?;
    let plaintext = crypto::decrypt(key, secret).map_err(|_| Error("DECRYPT_FAILED"))?;
    let payload: Value = serde_json::from_str(&plaintext).map_err(|_| Error("DECRYPT_FAILED"))?;
    for field in ["password", "notes", "fields"] {
        if let Some(entry) = payload.get(field) {
            value[field] = entry.clone()
        }
    }
    serde_json::from_value(value).map_err(|_| Error("DECRYPT_FAILED"))
}
pub fn summary(row: &Value, key: &[u8; 32]) -> Result<Value> {
    let mut value = base(row)?;
    value["hasSensitiveData"] = json!(row["has_secret"] == 1);
    if row["type"] == "api-key"
        && let Some(expiry) = from_row(row, key)?
            .fields
            .and_then(|fields| fields.get("expiresAt").cloned())
            .filter(|v| !v.is_empty())
    {
        value["expiresAt"] = json!(expiry)
    }
    Ok(value)
}
pub fn raw(db: &Connection, id: &str) -> Result<Value> {
    rows(db, "SELECT * FROM items WHERE id=?", [id])?
        .pop()
        .ok_or(Error("ITEM_NOT_FOUND"))
}
pub fn list(db: &Connection, key: &[u8; 32], trashed: bool) -> Result<Vec<Value>> {
    let sql = if trashed {
        "SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC"
    } else {
        "SELECT * FROM items WHERE deleted_at IS NULL ORDER BY pinned DESC,updated_at DESC"
    };
    rows(db, sql, [])?
        .iter()
        .map(|row| summary(row, key))
        .collect()
}
pub fn mark_used(db: &Connection, id: &str) -> Result<Option<i64>> {
    let at = now();
    Ok(
        if db.execute(
            "UPDATE items SET last_accessed_at=? WHERE id=? AND deleted_at IS NULL",
            params![at, id],
        )? > 0
        {
            Some(at)
        } else {
            None
        },
    )
}
pub fn get(db: &Connection, key: &[u8; 32], id: &str, record: bool) -> Result<Option<Item>> {
    let Some(row) = rows(db, "SELECT * FROM items WHERE id=?", [id])?.pop() else {
        return Ok(None);
    };
    let mut item = from_row(&row, key)?;
    if record {
        item.last_accessed_at = mark_used(db, id)?.or(item.last_accessed_at)
    }
    Ok(Some(item))
}
pub fn create(db: &Connection, key: &[u8; 32], input: &Item) -> Result<Value> {
    validate_project_id(db, input)?;
    let id = Uuid::new_v4().to_string();
    let at = now();
    let (secret, has_secret) = secret(input, key)?;
    db.execute("INSERT INTO items(id,type,title,project_id,environment,username,url,host,port,tags,secret,has_secret,favorite,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![id,input.r#type,input.title,input.project_id,input.environment,input.username,input.url,input.host,input.port,serde_json::to_string(&input.tags.as_deref().unwrap_or(&[]))?,secret,has_secret as i64,input.favorite as i64,input.pinned as i64,at,at])?;
    summary(&raw(db, &id)?, key)
}
pub fn update(db: &Connection, key: &[u8; 32], item: &Item) -> Result<Value> {
    validate_project_id(db, item)?;
    let previous = raw(db, &item.id)?;
    ensure(previous["deleted_at"].is_null(), "ITEM_IN_TRASH")?;
    let history = crypto::encrypt(key, &serde_json::to_string(&from_row(&previous, key)?)?)?;
    let (secret, has_secret) = secret(item, key)?;
    transaction(db, || {
        db.execute(
            "INSERT INTO item_history(item_id,saved_at,payload) VALUES(?,?,?)",
            params![item.id, now(), history],
        )?;
        db.execute("UPDATE items SET type=?,title=?,project_id=?,environment=?,username=?,url=?,host=?,port=?,tags=?,secret=?,has_secret=?,updated_at=? WHERE id=?",params![item.r#type,item.title,item.project_id,item.environment,item.username,item.url,item.host,item.port,serde_json::to_string(&item.tags.as_deref().unwrap_or(&[]))?,secret,has_secret as i64,now(),item.id])?;
        db.execute("DELETE FROM item_history WHERE item_id=? AND id NOT IN(SELECT id FROM item_history WHERE item_id=? ORDER BY id DESC LIMIT 20)",params![item.id,item.id])?;
        summary(&raw(db, &item.id)?, key)
    })
}
pub fn get_history(db: &Connection, key: &[u8; 32], id: &str, history_id: i64) -> Result<Item> {
    let row = rows(
        db,
        "SELECT payload FROM item_history WHERE item_id=? AND id=?",
        params![id, history_id],
    )?
    .pop()
    .ok_or(Error("HISTORY_NOT_FOUND"))?;
    Ok(serde_json::from_str(&crypto::decrypt(
        key,
        row["payload"].as_str().ok_or(Error("DECRYPT_FAILED"))?,
    )?)?)
}
pub fn batch(db: &Connection, key: &[u8; 32], ids: &[String], action: &Value) -> Result<usize> {
    ensure(
        !ids.is_empty() && ids.iter().all(|id| !id.is_empty()),
        "INVALID_DATA",
    )?;
    let kind = action["type"].as_str().ok_or(Error("INVALID_DATA"))?;
    ensure(
        ["project", "environment", "trash", "restore"].contains(&kind),
        "INVALID_DATA",
    )?;
    let field = if kind == "project" {
        "projectId"
    } else {
        "environment"
    };
    if ["project", "environment"].contains(&kind) {
        ensure(
            action.get(field).is_some() && (action[field].is_null() || action[field].is_string()),
            "INVALID_DATA",
        )?
    }
    transaction(db, || {
        let mut changed = 0;
        let mut seen = HashSet::new();
        for id in ids.iter().filter(|id| seen.insert(id.as_str())) {
            let row = raw(db, id)?;
            ensure(
                (kind == "restore") == !row["deleted_at"].is_null(),
                "ITEM_STATE_CHANGED",
            )?;
            match kind {
                "trash" => {
                    db.execute(
                        "UPDATE items SET deleted_at=? WHERE id=?",
                        params![now(), id],
                    )?;
                }
                "restore" => {
                    db.execute("UPDATE items SET deleted_at=NULL WHERE id=?", [id])?;
                }
                _ => {
                    let mut item = from_row(&row, key)?;
                    let value = action[field].as_str().map(str::to_owned);
                    if kind == "project" {
                        if item.project_id == value {
                            continue;
                        }
                        item.project_id = value;
                    } else {
                        if item.environment == value {
                            continue;
                        }
                        item.environment = value;
                    }
                    update(db, key, &item)?;
                }
            }
            changed += 1;
        }
        Ok(changed)
    })
}

const PROJECT_SELECT: &str = "SELECT p.*,(SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.deleted_at IS NULL) AS item_count FROM projects p";
pub fn projects(db: &Connection) -> Result<Vec<Value>> {
    rows(db, &format!("{PROJECT_SELECT} ORDER BY p.name"), [])?
        .into_iter()
        .map(|row| {
            let mut value =
                json!({"id":row["id"],"name":row["name"],"itemCount":row["item_count"]});
            for (source, target) in [
                ("icon", "icon"),
                ("color", "color"),
                ("description", "description"),
                ("last_accessed_at", "lastAccessedAt"),
            ] {
                if !row[source].is_null() {
                    value[target] = row[source].clone()
                }
            }
            Ok(value)
        })
        .collect()
}
pub fn validate_project(value: &Value) -> Result<Value> {
    let name = value["name"]
        .as_str()
        .ok_or(Error("INVALID_PROJECT"))?
        .trim();
    ensure(
        !name.is_empty() && name.encode_utf16().count() <= 80,
        "INVALID_PROJECT",
    )?;
    for (field, max) in [("icon", 8), ("description", 500)] {
        if let Some(entry) = value.get(field).filter(|v| !v.is_null()) {
            ensure(
                entry
                    .as_str()
                    .is_some_and(|v| v.encode_utf16().count() <= max),
                "INVALID_PROJECT",
            )?
        }
    }
    if let Some(color) = value.get("color").filter(|v| !v.is_null()) {
        ensure(
            color.as_str().is_some_and(|s| {
                s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
            }),
            "INVALID_PROJECT",
        )?
    }
    Ok(
        json!({"name":name,"icon":value["icon"],"color":value["color"],"description":value["description"].as_str().map(str::trim)}),
    )
}
pub fn save_project(db: &Connection, input: &Value, update: bool) -> Result<Value> {
    let value = validate_project(input)?;
    let id = if update {
        input["id"]
            .as_str()
            .ok_or(Error("INVALID_PROJECT"))?
            .to_owned()
    } else {
        Uuid::new_v4().to_string()
    };
    if update {
        ensure(
            !rows(db, "SELECT id FROM projects WHERE id=?", [&id])?.is_empty(),
            "PROJECT_NOT_FOUND",
        )?
    }
    ensure(
        rows(
            db,
            "SELECT id FROM projects WHERE name=? AND id!=?",
            params![value["name"].as_str(), id],
        )?
        .is_empty(),
        "PROJECT_NAME_EXISTS",
    )?;
    if update {
        db.execute(
            "UPDATE projects SET name=?,icon=?,color=?,description=? WHERE id=?",
            params![
                value["name"].as_str(),
                value["icon"].as_str(),
                value["color"].as_str(),
                value["description"].as_str(),
                id
            ],
        )?;
    } else {
        db.execute(
            "INSERT INTO projects(id,name,icon,color,description) VALUES(?,?,?,?,?)",
            params![
                id,
                value["name"].as_str(),
                value["icon"].as_str(),
                value["color"].as_str(),
                value["description"].as_str()
            ],
        )?;
    }
    projects(db)?
        .into_iter()
        .find(|p| p["id"] == id)
        .ok_or(Error("PROJECT_NOT_FOUND"))
}
pub fn health(db: &Connection, key: &[u8; 32]) -> Result<Value> {
    let mut results = Vec::<Value>::new();
    let mut passwords = HashMap::<Vec<u8>, usize>::new();
    let today = Local::now().date_naive();
    let week = today.checked_add_days(Days::new(7)).unwrap_or(today);
    for row in rows(
        db,
        "SELECT * FROM items WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        [],
    )? {
        let item = from_row(&row, key)?;
        let index = results.len();
        let mut issues = Vec::new();
        if let Some(password) = item.password.as_ref().filter(|v| !v.is_empty()) {
            if password.chars().count() < 12 {
                issues.push(json!("short-password"))
            }
            let hash = Sha256::digest(password.as_bytes()).to_vec();
            if let Some(first) = passwords.get(&hash) {
                let first_issues = results[*first]["issues"].as_array_mut().unwrap();
                if !first_issues.contains(&json!("reused-password")) {
                    first_issues.push(json!("reused-password"))
                }
                issues.push(json!("reused-password"));
            } else {
                passwords.insert(hash, index);
            }
        }
        if item.r#type == "api-key"
            && let Some(expiry) = item
                .fields
                .as_ref()
                .and_then(|v| v.get("expiresAt"))
                .filter(|v| !v.is_empty())
        {
            let issue = if !valid_date(expiry) {
                Some("invalid-expiry")
            } else {
                let date = NaiveDate::parse_from_str(expiry, "%Y-%m-%d")
                    .map_err(|_| Error("INVALID_EXPIRY"))?;
                if date < today {
                    Some("expired")
                } else if date <= week {
                    Some("expiring")
                } else {
                    None
                }
            };
            if let Some(issue) = issue {
                issues.push(json!(issue))
            }
        }
        results.push(json!({"id":item.id,"issues":issues}));
    }
    results.retain(|v| {
        v["issues"]
            .as_array()
            .is_some_and(|issues| !issues.is_empty())
    });
    Ok(json!(results))
}
