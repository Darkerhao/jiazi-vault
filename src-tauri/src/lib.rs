pub mod backup;
mod biometric;
pub mod crypto;
pub mod database;
mod desktop;
pub mod error;
pub mod items;
#[cfg(windows)]
mod system_lock;
#[cfg(target_os = "linux")]
mod system_lock_linux;
#[cfg(target_os = "macos")]
mod system_lock_macos;
pub mod transfer;
mod updates;
pub mod vault;

use error::{Error, Result, ensure};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::Sender,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub struct State {
    pub vault: Mutex<vault::Vault>,
    pub epoch: Arc<AtomicU64>,
    pub busy: AtomicBool,
    pub close: Mutex<Option<(String, Sender<bool>)>>,
    pub shortcut: Mutex<Value>,
    pub updates: Mutex<updates::Updates>,
    pub exit_allowed: AtomicBool,
}
struct Operation<'a>(&'a AtomicBool);
impl<'a> Operation<'a> {
    fn begin(flag: &'a AtomicBool) -> Result<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| Error("VAULT_BUSY"))?;
        Ok(Self(flag))
    }
}
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub fn application_url(url: &tauri::Url) -> bool {
    if cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1420)
    {
        return true;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
        || (url.scheme() == "https"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
}

#[tauri::command]
async fn vault_command(
    app: AppHandle,
    window: WebviewWindow,
    command: String,
    args: Value,
) -> Result<Value> {
    ensure(
        window.label() == "main"
            && application_url(&window.url().map_err(|_| Error("INVALID_IPC_SENDER"))?),
        "INVALID_IPC_SENDER",
    )?;
    if command == "lock_vault" {
        app.state::<State>().epoch.fetch_add(1, Ordering::SeqCst);
        let _ = app.emit("vault_locked", ());
    }
    tauri::async_runtime::spawn_blocking(move || dispatch(&app, &command, &args))
        .await
        .map_err(|_| Error("COMMAND_FAILED"))?
}
fn dispatch(app: &AppHandle, command: &str, args: &Value) -> Result<Value> {
    let state = app.state::<State>();
    match command {
        "get_update_state" => {
            return Ok(state
                .updates
                .lock()
                .map_err(|_| Error("UPDATE_BUSY"))?
                .state
                .clone());
        }
        "check_for_updates" => return updates::check(app),
        "get_recent_releases" => return updates::recent(),
        "install_update" => return updates::install(app),
        _ => {}
    }
    let file_command = matches!(
        command,
        "read_env_file"
            | "export_env"
            | "create_backup"
            | "configure_automatic_backup"
            | "select_backup_source"
            | "preview_import"
            | "export_plaintext"
    );
    let biometric_command = matches!(
        command,
        "get_biometric_status" | "enable_biometric" | "disable_biometric" | "unlock_biometric"
    );
    let _operation = if file_command || biometric_command && command != "get_biometric_status" {
        Some(Operation::begin(&state.busy)?)
    } else {
        None
    };
    if biometric_command {
        return biometric::dispatch(app, command, args);
    }
    if file_command
        || matches!(
            command,
            "respond_close_request"
                | "get_app_info"
                | "open_app_link"
                | "open_url"
                | "hide_window"
                | "get_desktop_status"
                | "set_search_shortcut"
                | "get_desktop_preferences"
                | "set_desktop_preference"
                | "copy_to_clipboard"
                | "copy_item"
        )
    {
        let result = desktop::dispatch(app, command, args);
        if matches!(command, "create_backup" | "configure_automatic_backup") {
            let _ = app.emit("backup_changed", ());
        }
        return result;
    }
    if state.busy.load(Ordering::SeqCst)
        && matches!(
            command,
            "create_vault"
                | "unlock_vault"
                | "change_master_password"
                | "preview_backup"
                | "restore_backup"
                | "confirm_import"
                | "run_automatic_backup"
        )
    {
        return Err(Error("VAULT_BUSY"));
    }
    let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    let before = vault.db.as_ref().and_then(|db| database::revision(db).ok());
    let was_active = vault.active();
    if vault.has_key() && !was_active {
        vault.lock();
        desktop::clear_clipboard(app, &mut vault);
        let _ = app.emit("vault_locked", ());
    }
    let started_epoch = vault.generation();
    let mut result = vault.call(command, args);
    if was_active
        && !matches!(
            command,
            "lock_vault" | "change_master_password" | "restore_backup"
        )
        && vault.generation() != started_epoch
    {
        result = Err(Error("VAULT_LOCKED"));
    }
    let changed = vault.db.as_ref().and_then(|db| database::revision(db).ok()) != before;
    if changed && vault.active() {
        let _ = vault.automatic_backup(false);
    }
    if (was_active && !vault.active()) || command == "lock_vault" {
        desktop::clear_clipboard(app, &mut vault);
        let _ = app.emit("vault_locked", ());
    }
    drop(vault);
    if changed || command == "run_automatic_backup" {
        let _ = app.emit("backup_changed", ());
    }
    result
}

fn maintenance(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ticks = 0_u32;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let state = app.state::<State>();
            if state.exit_allowed.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut vault) = state.vault.try_lock() else {
                continue;
            };
            if vault.has_key() && !vault.active() {
                vault.lock();
                desktop::clear_clipboard(&app, &mut vault);
                let _ = app.emit("vault_locked", ());
            }
            let timeout = vault.settings()["clipboardClearTimeout"].as_u64();
            if timeout.is_some_and(|seconds| vault.copied_at.elapsed().as_secs() >= seconds) {
                desktop::clear_clipboard(&app, &mut vault);
            }
            ticks += 1;
            if ticks >= 60 {
                ticks = 0;
                if let Some(db) = &vault.db
                    && database::purge(db).is_ok_and(|count| count > 0)
                {
                    let _ = app.emit("items_changed", ());
                }
                if !state.busy.load(Ordering::SeqCst)
                    && vault.automatic_backup(false).is_ok_and(|ran| ran)
                {
                    let _ = app.emit("backup_changed", ());
                }
            }
        }
    });
}

pub fn run() {
    let mut updater = tauri_plugin_updater::Builder::new();
    if let Some(key) = updates::PUBLIC_KEY.filter(|key| !key.trim().is_empty()) {
        updater = updater.pubkey(key);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop::show(app, "open")
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(updater.build())
        .invoke_handler(tauri::generate_handler![vault_command])
        .setup(|app| {
            // Electron used its package name here, not the product name or bundle identifier.
            let directory = std::env::var_os("KEYSTILL_DATA_DIR")
                .map(PathBuf::from)
                .or_else(|| dirs::config_dir().map(|path| path.join("jiazi-vault")))
                .ok_or(Error("DATABASE_ERROR"))?;
            let epoch = Arc::new(AtomicU64::new(0));
            app.manage(State {
                vault: Mutex::new(vault::Vault::new(directory, epoch.clone())),
                epoch,
                busy: AtomicBool::new(false),
                close: Mutex::new(None),
                shortcut: Mutex::new(json!({"shortcut":null,"shortcutRegistered":false})),
                updates: Mutex::new(updates::Updates::default()),
                exit_allowed: AtomicBool::new(false),
            });
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or(Error("DESKTOP_SETUP_FAILED"))?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(application_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        desktop::lock(window.app_handle());
                    }
                })
                .build()?;
            desktop::setup(app.handle())?;
            #[cfg(target_os = "macos")]
            system_lock_macos::register(app.handle());
            #[cfg(target_os = "linux")]
            system_lock_linux::register(app.handle());
            maintenance(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = updates::check(&handle);
                loop {
                    std::thread::sleep(Duration::from_secs(6 * 60 * 60));
                    if handle.state::<State>().exit_allowed.load(Ordering::SeqCst) {
                        break;
                    }
                    let _ = updates::check(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                desktop::request_close(window.app_handle(), false);
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize Keystill desktop runtime");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && !app.state::<State>().exit_allowed.load(Ordering::SeqCst)
        {
            api.prevent_exit();
            desktop::request_close(app, true);
        }
    });
}
