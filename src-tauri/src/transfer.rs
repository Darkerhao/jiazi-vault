use crate::{
    database as db,
    error::{Error, Result, ensure},
    items::{self, Item},
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

const COLUMNS: &[&str] = &[
    "type",
    "title",
    "project",
    "environment",
    "username",
    "password",
    "url",
    "host",
    "port",
    "notes",
    "tags",
    "fields",
    "favorite",
    "pinned",
    "createdAt",
    "updatedAt",
    "lastAccessedAt",
];
pub struct Record {
    pub row: usize,
    pub item: Option<Value>,
    pub error: Option<&'static str>,
}
fn validate(value: &Value) -> Result<Value> {
    ensure(
        value.as_object().is_some_and(|value| {
            value
                .iter()
                .all(|(key, entry)| COLUMNS.contains(&key.as_str()) && !entry.is_null())
        }),
        "INVALID_IMPORT",
    )?;
    let item: Item = serde_json::from_value(value.clone())?;
    items::validate(&item, true)?;
    if let Some(project) = value.get("project") {
        items::validate_project(&json!({"name":project}))?;
    }
    for field in ["createdAt", "updatedAt", "lastAccessedAt"] {
        if let Some(value) = value.get(field) {
            ensure(
                value
                    .as_i64()
                    .is_some_and(|n| (0..=9_007_199_254_740_991).contains(&n)),
                "INVALID_IMPORT",
            )?;
        }
    }
    let mut value = value.clone();
    if value.get("favorite").is_none() {
        value["favorite"] = json!(false)
    }
    if value.get("pinned").is_none() {
        value["pinned"] = json!(false)
    }
    Ok(value)
}
fn csv_unescape(text: &str) -> &str {
    if let Some(value) = text.strip_prefix('\'')
        && value.starts_with(['=', '+', '-', '@', '\t', '\r', '\n', '\''])
    {
        return value;
    }
    text
}
fn parse_csv(contents: &str) -> Result<Vec<Vec<String>>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let (mut quoted, mut closed) = (false, false);
    let mut characters = contents.chars().peekable();
    while let Some(character) = characters.next() {
        if quoted {
            if character != '"' {
                cell.push(character);
            } else if characters.peek() == Some(&'"') {
                cell.push('"');
                characters.next();
            } else {
                quoted = false;
                closed = true;
            }
        } else if [',', '\r', '\n'].contains(&character) {
            row.push(cell.clone());
            cell.clear();
            closed = false;
            if character != ',' {
                rows.push(std::mem::take(&mut row));
                if character == '\r' && characters.peek() == Some(&'\n') {
                    characters.next();
                }
            }
        } else if character == '"' && cell.is_empty() && !closed {
            quoted = true;
        } else {
            ensure(!closed && character != '"', "INVALID_IMPORT")?;
            cell.push(character);
        }
    }
    ensure(!quoted, "INVALID_IMPORT")?;
    if !cell.is_empty() || closed || !row.is_empty() {
        row.push(cell.clone());
        rows.push(row);
    }
    Ok(rows)
}

pub struct CsvSource {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}
impl CsvSource {
    pub fn parse(contents: &str) -> Result<Self> {
        ensure(contents.len() <= 64 * 1024 * 1024, "INVALID_IMPORT")?;
        let mut rows = parse_csv(contents.trim_start_matches('\u{feff}'))?.into_iter();
        let headers = rows.next().ok_or(Error("INVALID_IMPORT"))?;
        ensure(!headers.is_empty(), "INVALID_IMPORT")?;
        Ok(Self {
            headers,
            rows: rows.collect(),
        })
    }
    pub fn native_format(&self) -> bool {
        self.headers.iter().any(|v| v == "type")
            && self.headers.iter().any(|v| v == "title")
            && self.headers.iter().all(|v| COLUMNS.contains(&v.as_str()))
            && self.headers.iter().collect::<HashSet<_>>().len() == self.headers.len()
    }
    pub fn records(&self, mapping: Option<&Value>) -> Result<Vec<Record>> {
        let mut columns = Vec::new();
        let default_type = if let Some(mapping) = mapping {
            let fields = mapping["columns"]
                .as_object()
                .ok_or(Error("INVALID_MAPPING"))?;
            ensure(fields.contains_key("title"), "INVALID_MAPPING")?;
            let mut used = HashSet::new();
            for (name, index) in fields {
                let index = index.as_u64().ok_or(Error("INVALID_MAPPING"))? as usize;
                ensure(
                    ["title", "username", "password", "url", "type"].contains(&name.as_str())
                        && index < self.headers.len()
                        && used.insert(index),
                    "INVALID_MAPPING",
                )?;
                columns.push((name.as_str(), index));
            }
            let kind = mapping["defaultType"]
                .as_str()
                .ok_or(Error("INVALID_MAPPING"))?;
            validate(&json!({"type":kind,"title":"mapping"}))?;
            Some(kind)
        } else {
            ensure(self.native_format(), "INVALID_IMPORT")?;
            columns.extend(
                self.headers
                    .iter()
                    .enumerate()
                    .map(|(index, name)| (name.as_str(), index)),
            );
            None
        };
        let values = self
            .rows
            .iter()
            .map(|row| {
                if row.len() != self.headers.len() {
                    return Value::Null;
                }
                let mut value = json!({});
                if let Some(kind) = default_type {
                    value["type"] = json!(kind);
                }
                for &(name, index) in &columns {
                    let text = if mapping.is_none() {
                        csv_unescape(&row[index])
                    } else {
                        &row[index]
                    };
                    if text.is_empty() {
                        continue;
                    }
                    let parsed = if ["tags", "fields", "favorite", "pinned"].contains(&name) {
                        serde_json::from_str(text).unwrap_or(Value::Null)
                    } else if ["port", "createdAt", "updatedAt", "lastAccessedAt"].contains(&name) {
                        if text.bytes().all(|byte| byte.is_ascii_digit()) {
                            text.parse::<u64>().map_or(Value::Null, |v| json!(v))
                        } else {
                            Value::Null
                        }
                    } else {
                        json!(text)
                    };
                    value[name] = parsed;
                }
                value
            })
            .collect();
        records(values)
    }
}

pub fn parse(contents: &str, format: &str) -> Result<Vec<Record>> {
    ensure(contents.len() <= 64 * 1024 * 1024, "INVALID_IMPORT")?;
    match format {
        "json" => records(
            serde_json::from_str::<Vec<Value>>(contents.trim_start_matches('\u{feff}'))
                .map_err(|_| Error("INVALID_IMPORT"))?,
        ),
        "csv" => CsvSource::parse(contents)?.records(None),
        _ => Err(Error("INVALID_TRANSFER_FORMAT")),
    }
}
fn records(values: Vec<Value>) -> Result<Vec<Record>> {
    Ok(values
        .into_iter()
        .enumerate()
        .map(|(index, value)| match validate(&value) {
            Ok(item) => Record {
                row: index + 1,
                item: Some(item),
                error: None,
            },
            Err(error) => Record {
                row: index + 1,
                item: None,
                error: Some(if error.0 == "INVALID_EXPIRY" {
                    "过期日期需为有效的 YYYY-MM-DD。"
                } else {
                    "字段格式无效：请检查类型、名称、端口、项目及 tags/fields 格式。"
                }),
            },
        })
        .collect())
}
fn values(db: &Connection, key: &[u8; 32], scope: &Value) -> Result<Vec<Value>> {
    let projects = items::projects(db)?;
    let summaries = items::list(db, key, false)?;
    let kind = scope["kind"].as_str().unwrap_or("all");
    ensure(
        ["all", "project", "items"].contains(&kind),
        "INVALID_EXPORT_SCOPE",
    )?;
    let mut selected = HashSet::new();
    if kind == "items" {
        let ids = scope["ids"]
            .as_array()
            .ok_or(Error("INVALID_EXPORT_SCOPE"))?;
        ensure(!ids.is_empty(), "INVALID_EXPORT_SCOPE")?;
        for id in ids {
            let id = id
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or(Error("INVALID_EXPORT_SCOPE"))?;
            selected.insert(id);
        }
    }
    if kind == "project" {
        ensure(
            scope["projectId"].as_str().is_some_and(|id| !id.is_empty()),
            "INVALID_EXPORT_SCOPE",
        )?;
    }
    let mut values = Vec::new();
    for summary in summaries {
        if kind == "project" && summary["projectId"] != scope["projectId"] {
            continue;
        }
        if kind == "items" && !selected.remove(summary["id"].as_str().unwrap_or("")) {
            continue;
        }
        let item = items::get(db, key, summary["id"].as_str().unwrap(), false)?
            .ok_or(Error("EXPORT_ITEMS_CHANGED"))?;
        let mut value = serde_json::to_value(&item)?;
        let object = value.as_object_mut().unwrap();
        object.remove("id");
        object.remove("projectId");
        object.remove("deletedAt");
        if let Some(id) = item.project_id
            && let Some(project) = projects.iter().find(|project| project["id"] == id)
        {
            object.insert("project".into(), project["name"].clone());
        }
        values.push(value);
    }
    ensure(
        kind != "items" || selected.is_empty(),
        "EXPORT_ITEMS_CHANGED",
    )?;
    Ok(values)
}
fn fingerprint(item: &Value) -> Result<Vec<u8>> {
    let mut value = item.clone();
    let object = value.as_object_mut().ok_or(Error("INVALID_IMPORT"))?;
    for key in [
        "favorite",
        "pinned",
        "createdAt",
        "updatedAt",
        "lastAccessedAt",
    ] {
        object.remove(key);
    }
    object.retain(|_, v| v != "" && !v.is_null());
    if let Some(name) = object
        .get("project")
        .and_then(Value::as_str)
        .map(|name| name.trim().to_ascii_lowercase())
    {
        object.insert("project".into(), json!(name));
    }
    if let Some(tags) = object.get_mut("tags").and_then(Value::as_array_mut) {
        tags.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    for name in ["tags", "fields"] {
        if object.get(name).is_some_and(|v| {
            v.as_array().is_some_and(Vec::is_empty)
                || v.as_object().is_some_and(serde_json::Map::is_empty)
        }) {
            object.remove(name);
        }
    }
    // serde_json's default map is ordered, so nested object keys have a stable representation.
    Ok(Sha256::digest(value.to_string().as_bytes()).to_vec())
}
pub fn preview(db: &Connection, key: &[u8; 32], records: &[Record]) -> Result<Value> {
    let mut seen = values(db, key, &Value::Null)?
        .iter()
        .map(fingerprint)
        .collect::<Result<HashSet<_>>>()?;
    let mut rows = Vec::new();
    for record in records {
        let duplicate = if let Some(item) = &record.item {
            !seen.insert(fingerprint(item)?)
        } else {
            false
        };
        let mut row = json!({"row":record.row,"title":record.item.as_ref().map(|v|v["title"].clone()).unwrap_or(json!("无效记录")),"type":record.item.as_ref().map(|v|v["type"].clone()).unwrap_or(json!("")),"duplicate":duplicate});
        if let Some(error) = record.error {
            row["error"] = json!(error)
        }
        rows.push(row);
    }
    let invalid = rows.iter().filter(|row| row.get("error").is_some()).count();
    Ok(
        json!({"validCount":rows.len()-invalid,"duplicateCount":rows.iter().filter(|row|row["duplicate"]==true).count(),"invalidCount":invalid,"rows":rows}),
    )
}
pub fn import(
    db: &Connection,
    key: &[u8; 32],
    records: &[Record],
    skip_duplicates: bool,
) -> Result<usize> {
    let preview = preview(db, key, records)?;
    db::transaction(db, || {
        let mut count = 0;
        for (index, record) in records.iter().enumerate() {
            let Some(value) = &record.item else { continue };
            if skip_duplicates && preview["rows"][index]["duplicate"] == true {
                continue;
            }
            let mut item: Item = serde_json::from_value(validate(value)?)?;
            if let Some(name) = value["project"]
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
            {
                let found = db::rows(db, "SELECT id FROM projects WHERE name=?", [name])?.pop();
                let project = if let Some(project) = found {
                    project
                } else {
                    items::save_project(db, &json!({"name":name}), false)?
                };
                item.project_id = project["id"].as_str().map(str::to_owned);
            }
            let created = items::create(db, key, &item)?;
            db.execute(
                "UPDATE items SET created_at=?,updated_at=?,last_accessed_at=? WHERE id=?",
                params![
                    value["createdAt"]
                        .as_i64()
                        .unwrap_or(created["createdAt"].as_i64().unwrap()),
                    value["updatedAt"]
                        .as_i64()
                        .unwrap_or(created["updatedAt"].as_i64().unwrap()),
                    value["lastAccessedAt"].as_i64(),
                    created["id"].as_str()
                ],
            )?;
            count += 1;
        }
        Ok(count)
    })
}
pub fn export(db: &Connection, key: &[u8; 32], format: &str, scope: &Value) -> Result<String> {
    let values = values(db, key, scope)?;
    if format == "json" {
        return Ok(serde_json::to_string_pretty(&values)?);
    }
    ensure(format == "csv", "INVALID_TRANSFER_FORMAT")?;
    let mut output = format!("\u{feff}{}\r\n", COLUMNS.join(","));
    for item in values {
        let cells = COLUMNS
            .iter()
            .map(|column| {
                let mut text = match &item[column] {
                    Value::Null => String::new(),
                    Value::String(value) => value.clone(),
                    value => value.to_string(),
                };
                if text.starts_with(['=', '+', '-', '@', '\t', '\r', '\n', '\'']) {
                    text.insert(0, '\'');
                }
                format!("\"{}\"", text.replace('"', "\"\""))
            })
            .collect::<Vec<_>>();
        output.push_str(&cells.join(","));
        output.push_str("\r\n");
    }
    Ok(output)
}
pub fn env_fields(value: &Value) -> Result<BTreeMap<String, String>> {
    let fields = serde_json::from_value(value.clone())?;
    items::validate_env(&fields)?;
    Ok(fields)
}
