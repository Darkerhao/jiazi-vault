use crate::{
    State, backup, database as db,
    error::{Error, Result, ensure},
    items, transfer,
    vault::{self, PendingImport, PendingRestore},
};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, mpsc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use zeroize::Zeroizing;

pub fn show(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let foreground = window.is_focused().unwrap_or(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let action = if action == "quick-search-global" && foreground {
            "quick-search"
        } else {
            action
        };
        if action != "open" {
            let _ = app.emit("desktop_action", action);
        }
    }
}
pub fn lock(app: &AppHandle) {
    let state = app.state::<State>();
    // Invalidate before waiting for a running derivation or database operation.
    state.epoch.fetch_add(1, Ordering::SeqCst);
    let _ = app.emit("vault_locked", ());
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<State>();
        if let Ok(mut vault) = state.vault.lock() {
            vault.lock();
            clear_clipboard(&handle, &mut vault);
        }
        if let Ok(mut request) = state.close.lock()
            && let Some((_, sender)) = request.take()
        {
            let _ = sender.send(false);
        }
    });
}
pub fn clear_clipboard(app: &AppHandle, vault: &mut vault::Vault) {
    if let Some(owned) = vault.owned_clipboard.take()
        && app.clipboard().read_text().is_ok_and(|text| text == *owned)
    {
        let _ = app.clipboard().clear();
    }
}
fn write_clipboard(app: &AppHandle, vault: &mut vault::Vault, text: String) -> Result<()> {
    app.clipboard()
        .write_text(text.clone())
        .map_err(|_| Error("CLIPBOARD_FAILED"))?;
    vault.owned_clipboard = Some(Zeroizing::new(text));
    vault.copied_at = Instant::now();
    Ok(())
}
fn copy(app: &AppHandle, text: String, item: Option<&str>) -> Result<Value> {
    let state = app.state::<State>();
    let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    vault.key()?;
    write_clipboard(app, &mut vault, text)?;
    Ok(json!(
        item.map(|id| items::mark_used(vault.connection()?, id))
            .transpose()?
            .flatten()
    ))
}
pub fn confirm_close(app: &AppHandle) -> Result<bool> {
    let state = app.state::<State>();
    ensure(!state.busy.load(Ordering::SeqCst), "VAULT_BUSY")?;
    let unlocked = state
        .vault
        .lock()
        .map_err(|_| Error("VAULT_BUSY"))?
        .active();
    if unlocked {
        let (send, receive) = mpsc::channel();
        let token = vault::id();
        {
            let mut pending = state.close.lock().map_err(|_| Error("VAULT_BUSY"))?;
            ensure(pending.is_none(), "VAULT_BUSY")?;
            *pending = Some((token.clone(), send));
        }
        show(app, "open");
        app.emit("close_requested", token)
            .map_err(|_| Error("CLOSE_REQUEST_FAILED"))?;
        let allowed = receive
            .recv_timeout(Duration::from_secs(120))
            .unwrap_or(false);
        state.close.lock().map_err(|_| Error("VAULT_BUSY"))?.take();
        if !allowed {
            return Ok(false);
        }
    }
    let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    ensure(!state.busy.load(Ordering::SeqCst), "VAULT_BUSY")?;
    vault.lock();
    clear_clipboard(app, &mut vault);
    drop(vault);
    let _ = app.emit("vault_locked", ());
    Ok(true)
}
pub fn request_close(app: &AppHandle, quit: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !confirm_close(&app).unwrap_or(false) {
            return;
        }
        let state = app.state::<State>();
        let to_tray = state
            .vault
            .lock()
            .ok()
            .and_then(|vault| {
                vault
                    .db
                    .as_ref()
                    .and_then(|db| db::setting(db, "desktop-preferences").ok().flatten())
            })
            .is_none_or(|settings| settings["closeToTray"] != false);
        if !quit && to_tray {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        } else {
            state.exit_allowed.store(true, Ordering::SeqCst);
            app.exit(0);
        }
    });
}
fn window(app: &AppHandle) -> Result<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or(Error("DESKTOP_RUNTIME_UNAVAILABLE"))
}
fn checkpoint(app: &AppHandle) -> Result<u64> {
    let state = app.state::<State>();
    let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    vault.key()?;
    Ok(vault.generation())
}
fn active(app: &AppHandle, epoch: u64) -> Result<()> {
    let state = app.state::<State>();
    let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    vault.check_epoch(epoch)?;
    vault.key()?;
    Ok(())
}
fn choose(
    app: &AppHandle,
    title: &str,
    extensions: &[&str],
    save: bool,
    name: &str,
) -> Result<Option<PathBuf>> {
    let mut picker = app
        .dialog()
        .file()
        .set_parent(&window(app)?)
        .set_title(title);
    if !extensions.is_empty() {
        picker = picker.add_filter(title, extensions)
    }
    if !name.is_empty() {
        picker = picker.set_file_name(name)
    }
    let selected = if save {
        picker.blocking_save_file()
    } else {
        picker.blocking_pick_file()
    };
    selected
        .map(|path| path.into_path().map_err(|_| Error("INVALID_DATA")))
        .transpose()
}
fn confirm(app: &AppHandle, title: &str, detail: &str) -> Result<bool> {
    Ok(app
        .dialog()
        .message(detail)
        .title(title)
        .parent(&window(app)?)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "确认".into(),
            "取消".into(),
        ))
        .blocking_show())
}
fn name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn extension(path: PathBuf, format: &str) -> PathBuf {
    if path
        .extension()
        .is_some_and(|value| value.to_string_lossy().eq_ignore_ascii_case(format))
    {
        path
    } else {
        let mut value = path.into_os_string();
        value.push(format!(".{format}"));
        PathBuf::from(value)
    }
}

pub fn configure_shortcut(app: &AppHandle, value: Option<&str>) -> Result<Value> {
    if let Some(value) = value {
        let parts = value.split('+').collect::<Vec<_>>();
        let valid = parts.first() == Some(&"CommandOrControl")
            && matches!(
                parts.as_slice(),
                [_, "Alt", _] | [_, "Shift", _] | [_, "Alt", "Shift", _]
            )
            && parts.last().is_some_and(|key| {
                key.len() == 1 && key.as_bytes()[0].is_ascii_uppercase()
                    || key.len() == 1 && key.as_bytes()[0].is_ascii_digit()
            });
        ensure(valid, "INVALID_SHORTCUT")?;
        ensure(
            ![
                "CommandOrControl+Shift+L",
                "CommandOrControl+Shift+N",
                "CommandOrControl+Shift+C",
            ]
            .contains(&value),
            "RESERVED_SHORTCUT",
        )?;
    }
    let state = app.state::<State>();
    app.global_shortcut()
        .unregister_all()
        .map_err(|_| Error("SHORTCUT_FAILED"))?;
    let registered = value.is_some_and(|shortcut| {
        app.global_shortcut()
            .on_shortcut(shortcut, |app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    show(app, "quick-search-global")
                }
            })
            .is_ok()
    });
    let status = json!({"shortcut":value,"shortcutRegistered":registered});
    *state.shortcut.lock().map_err(|_| Error("VAULT_BUSY"))? = status.clone();
    Ok(status)
}
pub fn dispatch(app: &AppHandle, command: &str, args: &Value) -> Result<Value> {
    let state = app.state::<State>();
    match command {
        "hide_window" => {
            window(app)?
                .hide()
                .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
            Ok(Value::Null)
        }
        "open_url" => {
            let raw = vault::text(args, "url")?.trim();
            ensure(raw.len() <= 2048, "INVALID_URL")?;
            let parsed = tauri::Url::parse(raw).map_err(|_| Error("INVALID_URL"))?;
            ensure(
                matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some(),
                "INVALID_URL",
            )?;
            app.opener()
                .open_url(parsed.as_str(), None::<&str>)
                .map_err(|_| Error("OPEN_LINK_FAILED"))?;
            let used = if let Some(id) = args["itemId"].as_str() {
                let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
                vault.key()?;
                items::mark_used(vault.connection()?, id)?
            } else {
                None
            };
            Ok(json!(used))
        }
        "respond_close_request" => {
            let token = vault::text(args, "token")?;
            let allowed = args["allowed"].as_bool().ok_or(Error("INVALID_DATA"))?;
            let mut pending = state.close.lock().map_err(|_| Error("VAULT_BUSY"))?;
            if pending.as_ref().is_some_and(|(saved, _)| saved == token)
                && let Some((_, sender)) = pending.take()
            {
                let _ = sender.send(allowed);
            }
            Ok(Value::Null)
        }
        "get_app_info" => Ok(
            json!({"version":app.package_info().version.to_string(),"platform":if cfg!(windows){"win32"}else if cfg!(target_os="macos"){"darwin"}else{"linux"},"arch":std::env::consts::ARCH,"systemVersion":system_version(),"tauriVersion":tauri::VERSION,"webviewVersion":tauri::webview_version().unwrap_or_else(|_|"未知".into())}),
        ),
        "open_app_link" => {
            let url = match vault::text(args, "target")? {
                "project" => "https://github.com/Darkerhao/jiazi-vault".into(),
                "guide" => "https://github.com/Darkerhao/jiazi-vault#readme".into(),
                "feedback" => "https://github.com/Darkerhao/jiazi-vault/issues/new".into(),
                "releases" => "https://github.com/Darkerhao/jiazi-vault/releases/latest".into(),
                "history" => "https://github.com/Darkerhao/jiazi-vault/releases".into(),
                "release" => {
                    let tag = vault::text(args, "tag")?;
                    semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
                        .map_err(|_| Error("INVALID_DATA"))?;
                    ensure(
                        tag.bytes()
                            .all(|ch| ch.is_ascii_digit() || b"v.".contains(&ch)),
                        "INVALID_DATA",
                    )?;
                    format!("https://github.com/Darkerhao/jiazi-vault/releases/tag/{tag}")
                }
                _ => return Err(Error("INVALID_DATA")),
            };
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| Error("OPEN_LINK_FAILED"))?;
            Ok(Value::Null)
        }
        "get_desktop_status" => Ok(state
            .shortcut
            .lock()
            .map_err(|_| Error("VAULT_BUSY"))?
            .clone()),
        "set_search_shortcut" => {
            checkpoint(app)?;
            ensure(
                args.get("shortcut").is_some()
                    && (args["shortcut"].is_null() || args["shortcut"].is_string()),
                "INVALID_SHORTCUT",
            )?;
            let status = configure_shortcut(app, args["shortcut"].as_str())?;
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            db::save_setting(vault.connection()?, "search-shortcut", &args["shortcut"])?;
            Ok(status)
        }
        "get_desktop_preferences" | "set_desktop_preference" => {
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            let mut preferences = if let Some(db) = &vault.db {
                db::setting(db, "desktop-preferences")?
                    .unwrap_or(json!({"silentStart":false,"closeToTray":true}))
            } else {
                json!({"silentStart":false,"closeToTray":true})
            };
            let supported = !cfg!(debug_assertions) && (cfg!(windows) || cfg!(target_os = "macos"));
            if command == "set_desktop_preference" {
                vault.key()?;
                let key = vault::text(args, "key")?;
                let value = args["value"].as_bool().ok_or(Error("INVALID_SETTINGS"))?;
                match key {
                    "openAtLogin" => {
                        ensure(supported, "LOGIN_ITEM_UNSUPPORTED")?;
                        if value {
                            app.autolaunch().enable()
                        } else {
                            app.autolaunch().disable()
                        }
                        .map_err(|_| Error("LOGIN_ITEM_UPDATE_FAILED"))?;
                        ensure(
                            app.autolaunch()
                                .is_enabled()
                                .map_err(|_| Error("LOGIN_ITEM_UPDATE_FAILED"))?
                                == value,
                            "LOGIN_ITEM_UPDATE_FAILED",
                        )?;
                    }
                    "silentStart" | "closeToTray" => {
                        preferences[key] = json!(value);
                        db::save_setting(vault.connection()?, "desktop-preferences", &preferences)?;
                    }
                    _ => return Err(Error("INVALID_SETTINGS")),
                }
            }
            preferences["startupSupported"] = json!(supported);
            preferences["openAtLogin"] =
                json!(supported && app.autolaunch().is_enabled().unwrap_or(false));
            Ok(preferences)
        }
        "copy_to_clipboard" => copy(
            app,
            vault::text(args, "text")?.into(),
            args["itemId"].as_str(),
        ),
        "copy_item" => {
            let id = vault::text(args, "id")?;
            let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            let key = vault.key()?;
            let item = items::get(vault.connection()?, key, id, false)?
                .ok_or(Error("ITEM_NOT_FOUND"))?;
            if item.r#type == "env" {
                let contents = items::serialize_env(
                    item.fields
                        .as_ref()
                        .ok_or(Error("ENV_EXPORT_FAILED"))?,
                )?;
                drop(vault);
                if !confirm(
                    app,
                    "复制完整 .env",
                    "即将把全部环境变量以明文复制到系统剪贴板。系统剪贴板可被其他应用读取，请妥善保管。",
                )? {
                    return Ok(Value::Null);
                }
                let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
                vault.key()?;
                write_clipboard(app, &mut vault, contents)?;
                let used = items::mark_used(vault.connection()?, id)?;
                return Ok(json!({"copied": true, "usedAt": used}));
            }
            let Some(secret) = items::primary(&item) else {
                return Ok(json!({"copied": false, "usedAt": null}));
            };
            write_clipboard(app, &mut vault, secret)?;
            let used = items::mark_used(vault.connection()?, id)?;
            Ok(json!({"copied": true, "usedAt": used}))
        }
        "read_env_file" => {
            let epoch = checkpoint(app)?;
            let Some(path) = choose(app, "导入 .env 文件", &[], false, "")? else {
                return Ok(Value::Null);
            };
            active(app, epoch)?;
            let contents = backup::read_file(&path, 1024 * 1024)?;
            active(app, epoch)?;
            Ok(json!({"name":name(&path),"contents":contents}))
        }
        "export_env" => {
            let epoch = checkpoint(app)?;
            let fields = transfer::env_fields(&args["fields"])?;
            let contents = items::serialize_env(&fields)?;
            let to_file = match vault::text(args, "destination")? {
                "clipboard" => false,
                "file" => true,
                _ => return Err(Error("INVALID_DATA")),
            };
            if !confirm(
                app,
                if to_file { "导出明文 .env" } else { "复制完整 .env" },
                if to_file {
                    "即将以明文导出全部环境变量。文件可被其他应用读取，请妥善保管并避免提交到版本库。"
                } else {
                    "即将把全部环境变量以明文复制到系统剪贴板。系统剪贴板可被其他应用读取，请妥善保管。"
                },
            )? {
                return Ok(Value::Null);
            }
            active(app, epoch)?;
            if !to_file {
                let used = copy(app, contents, args["itemId"].as_str())?;
                return Ok(json!({"name":".env","usedAt":used}));
            }
            let Some(path) = choose(app, "导出 .env", &[], true, ".env")? else {
                return Ok(Value::Null);
            };
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            vault.key()?;
            backup::write_private_guarded(&path, contents.as_bytes(), || {
                vault.check_epoch(epoch)?;
                vault.key()?;
                Ok(())
            })?;
            Ok(
                json!({"name":name(&path),"usedAt":args["itemId"].as_str().map(|id|items::mark_used(vault.connection()?,id)).transpose()?.flatten()}),
            )
        }
        "create_backup" => {
            let epoch = checkpoint(app)?;
            let Some(path) = choose(
                app,
                "保存加密备份",
                &["jvault"],
                true,
                &format!(
                    "keystill-backup-{}.jvault",
                    chrono::Local::now().format("%Y-%m-%d")
                ),
            )?
            else {
                return Ok(Value::Null);
            };
            let path = extension(path, "jvault");
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            let db = vault.connection()?;
            let revision = db::revision(db)?;
            let contents = backup::create(db, vault.key()?)?;
            backup::write_private_guarded(&path, contents.as_bytes(), || {
                vault.check_epoch(epoch)?;
                vault.key()?;
                Ok(())
            })?;
            db::record_backup(db, revision)?;
            Ok(json!(name(&path)))
        }
        "configure_automatic_backup" => {
            let epoch = checkpoint(app)?;
            let enabled = args["enabled"].as_bool().ok_or(Error("INVALID_DATA"))?;
            let path = if enabled {
                let picked = app
                    .dialog()
                    .file()
                    .set_parent(&window(app)?)
                    .set_title("选择自动备份位置")
                    .blocking_pick_folder();
                let Some(path) = picked else {
                    return Ok(Value::Null);
                };
                let path = path
                    .into_path()
                    .map_err(|_| Error("INVALID_DATA"))?
                    .join(format!("keystill-backups-{}", vault::id()));
                active(app, epoch)?;
                fs::create_dir_all(&path)?;
                Some(path)
            } else {
                None
            };
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            vault.key()?;
            db::save_setting(
                vault.connection()?,
                "automatic_backup",
                &json!({"directory":path}),
            )?;
            vault.connection()?.execute("DELETE FROM settings WHERE key IN('automatic_backup_record','automatic_backup_error')",[])?;
            if enabled {
                vault.automatic_backup(true)?;
            }
            Ok(Value::Null)
        }
        "select_backup_source" => {
            let epoch = state.epoch.load(Ordering::SeqCst);
            let mut source = PendingRestore {
                token: vault::id(),
                epoch,
                name: String::new(),
                path: None,
                snapshot_id: None,
                backup: None,
            };
            if let Some(id) = args.get("snapshotId") {
                let id = id.as_str().ok_or(Error("INVALID_SNAPSHOT"))?;
                let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
                ensure(
                    backup::snapshots(&vault.directory)?
                        .iter()
                        .any(|value| value["id"] == id),
                    "INVALID_SNAPSHOT",
                )?;
                source.snapshot_id = Some(id.into());
                source.name = format!("恢复前快照 · {id}");
            } else {
                let Some(path) = choose(app, "选择加密备份", &["jvault"], false, "")? else {
                    return Ok(Value::Null);
                };
                ensure(
                    fs::metadata(&path)?.len() <= backup::MAX_BYTES,
                    "BACKUP_TOO_LARGE",
                )?;
                source.name = name(&path);
                source.path = Some(path);
            }
            let result = json!({"token":source.token,"name":source.name});
            let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            vault.pending_restore = Some(source);
            Ok(result)
        }
        "preview_import" => {
            let epoch = checkpoint(app)?;
            let Some(path) = choose(app, "导入 JSON / CSV", &["json", "csv"], false, "")? else {
                return Ok(Value::Null);
            };
            active(app, epoch)?;
            let contents = Zeroizing::new(backup::read_file(&path, 64 * 1024 * 1024)?);
            let format = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            let records = transfer::parse(&contents, &format)?;
            let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            let mut preview = transfer::preview(vault.connection()?, vault.key()?, &records)?;
            let token = vault::id();
            preview["token"] = json!(token);
            preview["name"] = json!(name(&path));
            vault.pending_import = Some(PendingImport {
                token,
                epoch,
                name: name(&path),
                records,
            });
            Ok(preview)
        }
        "export_plaintext" => {
            let epoch = checkpoint(app)?;
            let format = vault::text(args, "format")?;
            ensure(["json", "csv"].contains(&format), "INVALID_TRANSFER_FORMAT")?;
            if !confirm(
                app,
                "导出明文凭证",
                "即将以明文导出所选范围内有效凭证的密码、私钥及其他敏感信息，不包含回收站。任何获得此文件的人都可以读取其中的凭证。请妥善保管并在使用后删除明文文件。",
            )? {
                return Ok(Value::Null);
            }
            active(app, epoch)?;
            let Some(path) = choose(
                app,
                "导出明文凭证",
                &[format],
                true,
                &format!(
                    "keystill-{}.{format}",
                    chrono::Local::now().format("%Y-%m-%d")
                ),
            )?
            else {
                return Ok(Value::Null);
            };
            let path = extension(path, format);
            let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
            vault.check_epoch(epoch)?;
            let contents = Zeroizing::new(transfer::export(
                vault.connection()?,
                vault.key()?,
                format,
                &args["scope"],
            )?);
            backup::write_private_guarded(&path, contents.as_bytes(), || {
                vault.check_epoch(epoch)?;
                vault.key()?;
                Ok(())
            })?;
            Ok(json!(name(&path)))
        }
        _ => Err(Error("INVALID_COMMAND")),
    }
}

fn system_version() -> String {
    #[cfg(windows)]
    {
        let version = windows_version::OsVersion::current();
        format!("{}.{}.{}", version.major, version.minor, version.build)
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_owned())
            .unwrap_or_else(|| "macOS".into())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    line.strip_prefix("PRETTY_NAME=")
                        .map(|s| s.trim_matches('"').to_owned())
                })
            })
            .unwrap_or_else(|| std::env::consts::OS.into())
    }
}

pub fn setup(app: &AppHandle) -> Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "open", "打开保险库", true, None::<&str>)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let search = MenuItem::with_id(app, "quick-search", "快捷搜索", true, None::<&str>)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let generator = MenuItem::with_id(app, "generator", "生成密码", true, None::<&str>)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let lock_item = MenuItem::with_id(app, "lock", "锁定保险库", true, None::<&str>)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let menu = Menu::with_items(
        app,
        &[&open, &search, &generator, &lock_item, &separator, &quit],
    )
    .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let icon = tauri::image::Image::from_bytes(if cfg!(target_os = "macos") {
        include_bytes!("../../public/brand/trayTemplate@2x.png")
    } else {
        include_bytes!("../../public/brand/tray@2x.png")
    })
    .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Keystill")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => request_close(app, true),
            "lock" => lock(app),
            "quick-search" => show(app, "quick-search-global"),
            action => show(app, action),
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle(), "open")
            }
        })
        .build(app)
        .map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
    let state = app.state::<State>();
    let (shortcut, silent) = {
        let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
        let shortcut = vault
            .db
            .as_ref()
            .and_then(|db| db::setting(db, "search-shortcut").ok().flatten())
            .unwrap_or(json!("CommandOrControl+Alt+K"));
        let silent = vault.db.as_ref().is_some_and(|db| {
            db::metadata(db).ok().flatten().is_some()
                && db::setting(db, "desktop-preferences")
                    .ok()
                    .flatten()
                    .is_some_and(|value| value["silentStart"] == true)
        });
        (shortcut, silent)
    };
    configure_shortcut(app, shortcut.as_str())?;
    #[cfg(windows)]
    crate::system_lock::register(app)?;
    if !silent {
        show(app, "open")
    }
    Ok(())
}
