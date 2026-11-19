use std::collections::HashMap;
use tauri::AppHandle;
use zbus::{
    MatchRule,
    blocking::{Connection, MessageIterator, Proxy},
    message::Type,
    zvariant::{OwnedObjectPath, OwnedValue},
};

fn monitor(app: &AppHandle) -> zbus::Result<()> {
    let connection = Connection::system()?;
    let manager = Proxy::new(
        &connection,
        "org.freedesktop.login1",
        "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager",
    )?;
    let session: Option<OwnedObjectPath> =
        manager.call("GetSessionByPID", &(std::process::id(),)).ok();
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.login1")?
        .path_namespace("/org/freedesktop/login1")?
        .build();
    for message in MessageIterator::for_match_rule(rule, &connection, Some(32))? {
        let message = message?;
        let header = message.header();
        match header.member().map(|name| name.as_str()) {
            Some("PrepareForSleep") => {
                if message
                    .body()
                    .deserialize::<(bool,)>()
                    .is_ok_and(|(sleep,)| sleep)
                {
                    crate::desktop::lock(app)
                }
            }
            Some("Lock")
                if session.as_ref().is_some_and(|path| {
                    header
                        .path()
                        .is_some_and(|current| current.as_str() == path.as_str())
                }) =>
            {
                crate::desktop::lock(app)
            }
            Some("PropertiesChanged")
                if session.as_ref().is_some_and(|path| {
                    header
                        .path()
                        .is_some_and(|current| current.as_str() == path.as_str())
                }) =>
            {
                if let Ok((interface, changed, _)) =
                    message
                        .body()
                        .deserialize::<(String, HashMap<String, OwnedValue>, Vec<String>)>()
                    && interface == "org.freedesktop.login1.Session"
                    && changed
                        .get("LockedHint")
                        .and_then(|value| bool::try_from(value).ok())
                        == Some(true)
                {
                    crate::desktop::lock(app)
                }
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn register(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if monitor(&app).is_err() {
            eprintln!("Keystill: system session notifications unavailable");
        }
    });
}
