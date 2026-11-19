use crate::{
    State,
    error::{Error, Result, ensure},
};
use semver::Version;
use serde_json::{Value, json};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const API: &str = "https://api.github.com/repos/Darkerhao/jiazi-vault/releases";
const ENDPOINT: &str =
    "https://github.com/Darkerhao/jiazi-vault/releases/latest/download/tauri-updater.json";
pub const PUBLIC_KEY: Option<&str> = option_env!("TAURI_UPDATER_PUBLIC_KEY");
pub struct Updates {
    pub state: Value,
    pub ready: Option<(Update, Vec<u8>)>,
}
impl Default for Updates {
    fn default() -> Self {
        let supported = !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some();
        Self {
            state: json!({"automatic":supported && PUBLIC_KEY.is_some_and(|key|!key.trim().is_empty()) && !cfg!(debug_assertions),"status":"idle","update":null,"percent":0,"error":""}),
            ready: None,
        }
    }
}
pub fn publish(app: &AppHandle, patch: Value) -> Result<Value> {
    let state = app.state::<State>();
    let mut updates = state.updates.lock().map_err(|_| Error("UPDATE_BUSY"))?;
    for (key, value) in patch.as_object().ok_or(Error("INVALID_DATA"))? {
        updates.state[key] = value.clone();
    }
    let value = updates.state.clone();
    drop(updates);
    let _ = app.emit("update_state", &value);
    Ok(value)
}
fn fetch(path: &str) -> Result<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error("UPDATE_CHECK_FAILED"))?;
    let response = client
        .get(format!("{API}{path}"))
        .header("User-Agent", "Keystill")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|_| Error("UPDATE_CHECK_FAILED"))?;
    if response.status().as_u16() == 404 {
        return Ok(Value::Null);
    }
    ensure(
        ![403, 429].contains(&response.status().as_u16()),
        "UPDATE_RATE_LIMITED",
    )?;
    ensure(response.status().is_success(), "UPDATE_CHECK_FAILED")?;
    let bytes = response.bytes().map_err(|_| Error("UPDATE_CHECK_FAILED"))?;
    ensure(bytes.len() <= 4 * 1024 * 1024, "INVALID_RELEASE")?;
    serde_json::from_slice(&bytes).map_err(|_| Error("INVALID_RELEASE"))
}
pub fn parse_release(value: &Value) -> Result<Value> {
    let tag = value["tag_name"].as_str().ok_or(Error("INVALID_RELEASE"))?;
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| Error("INVALID_RELEASE"))?;
    ensure(
        version.pre.is_empty()
            && version.build.is_empty()
            && value["draft"] == false
            && value["prerelease"] == false
            && (value["body"].is_null() || value["body"].is_string()),
        "INVALID_RELEASE",
    )?;
    Ok(
        json!({"tag":tag,"version":version.to_string(),"notes":value["body"].as_str().filter(|s|!s.is_empty()).unwrap_or("此版本暂无更新说明。"),"publishedAt":value["published_at"].as_str()}),
    )
}
pub fn recent() -> Result<Value> {
    let data = fetch("?per_page=20")?;
    if data.is_null() {
        return Ok(json!([]));
    }
    let releases = data
        .as_array()
        .ok_or(Error("INVALID_RELEASE"))?
        .iter()
        .filter(|value| value["draft"] == false && value["prerelease"] == false)
        .map(parse_release)
        .collect::<Result<Vec<_>>>()?;
    let mut releases = releases
        .into_iter()
        .map(|value| {
            Ok((
                Version::parse(value["version"].as_str().unwrap())
                    .map_err(|_| Error("INVALID_RELEASE"))?,
                value,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    releases.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(json!(
        releases
            .into_iter()
            .take(5)
            .map(|(_, value)| value)
            .collect::<Vec<_>>()
    ))
}
pub fn check(app: &AppHandle) -> Result<Value> {
    {
        let state = app.state::<State>();
        let updates = state.updates.lock().map_err(|_| Error("UPDATE_BUSY"))?;
        if [
            "checking",
            "downloading",
            "confirming",
            "installing",
            "ready",
        ]
        .contains(&updates.state["status"].as_str().unwrap_or(""))
        {
            return Ok(updates.state.clone());
        }
    }
    publish(app, json!({"status":"checking","error":""}))?;
    let result = (|| {
        let data = fetch("/latest")?;
        if data.is_null() {
            return publish(app, json!({"status":"current","update":null,"percent":0}));
        }
        let release = parse_release(&data)?;
        let version = Version::parse(release["version"].as_str().unwrap())
            .map_err(|_| Error("INVALID_RELEASE"))?;
        let newer = version > app.package_info().version;
        publish(
            app,
            json!({"status":if newer{"available"}else{"current"},"update":{"version":release["version"],"notes":release["notes"],"newer":newer},"percent":0}),
        )
    })();
    if let Err(error) = result {
        fail(app, error)
    } else {
        result
    }
}
fn fail(app: &AppHandle, error: Error) -> Result<Value> {
    publish(
        app,
        json!({"status":"error","error":match error.0{"UPDATE_RATE_LIMITED"=>"GitHub 请求过于频繁，请稍后重试。","UPDATE_SIGNATURE_INVALID"=>"更新签名验证失败，请从官方下载页检查版本。",_=>"无法完成更新，请检查网络连接或从官方下载页重试。"}}),
    )
}
pub fn install(app: &AppHandle) -> Result<Value> {
    let state = app.state::<State>();
    ensure(
        !state.busy.load(std::sync::atomic::Ordering::SeqCst),
        "VAULT_BUSY",
    )?;
    let (automatic, status) = {
        let updates = state.updates.lock().map_err(|_| Error("UPDATE_BUSY"))?;
        (
            updates.state["automatic"] == true,
            updates.state["status"].as_str().unwrap_or("").to_owned(),
        )
    };
    ensure(automatic, "UPDATE_MANUAL_REQUIRED")?;
    ensure(
        !["checking", "downloading", "confirming", "installing"].contains(&status.as_str()),
        "UPDATE_BUSY",
    )?;
    let result = (|| {
        let ready = state
            .updates
            .lock()
            .map_err(|_| Error("UPDATE_BUSY"))?
            .ready
            .take();
        let (update, bytes) = if let Some(ready) = ready {
            ready
        } else {
            let updater = app
                .updater_builder()
                .endpoints(vec![
                    ENDPOINT.parse().map_err(|_| Error("UPDATE_CHECK_FAILED"))?,
                ])
                .map_err(|_| Error("UPDATE_CHECK_FAILED"))?
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| Error("UPDATE_CHECK_FAILED"))?;
            let update = tauri::async_runtime::block_on(updater.check())
                .map_err(|_| Error("UPDATE_CHECK_FAILED"))?
                .ok_or(Error("UPDATE_NOT_AVAILABLE"))?;
            ensure(
                update.download_url.scheme() == "https"
                    && update.download_url.host_str() == Some("github.com")
                    && update
                        .download_url
                        .path()
                        .starts_with("/Darkerhao/jiazi-vault/releases/download/"),
                "INVALID_RELEASE",
            )?;
            publish(app, json!({"status":"downloading","percent":0,"error":""}))?;
            let mut received = 0_u64;
            let bytes = tauri::async_runtime::block_on(update.download(
                |length, total| {
                    received += length as u64;
                    let percent = total
                        .filter(|total| *total > 0)
                        .map(|total| (received as f64 / total as f64 * 100.0).min(100.0))
                        .unwrap_or(0.0);
                    let _ = publish(app, json!({"percent":percent}));
                },
                || {},
            ))
            .map_err(|_| Error("UPDATE_SIGNATURE_INVALID"))?;
            (update, bytes)
        };
        publish(app, json!({"status":"confirming","percent":100}))?;
        if !crate::desktop::confirm_close(app)? {
            state
                .updates
                .lock()
                .map_err(|_| Error("UPDATE_BUSY"))?
                .ready = Some((update, bytes));
            return publish(app, json!({"status":"ready"}));
        }
        publish(app, json!({"status":"installing"}))?;
        // Verification is performed by the official updater before this installation call.
        state
            .exit_allowed
            .store(true, std::sync::atomic::Ordering::SeqCst);
        update.install(&bytes).map_err(|_| {
            state
                .exit_allowed
                .store(false, std::sync::atomic::Ordering::SeqCst);
            Error("UPDATE_INSTALL_FAILED")
        })?;
        app.restart()
    })();
    if let Err(error) = result {
        fail(app, error)
    } else {
        result
    }
}
