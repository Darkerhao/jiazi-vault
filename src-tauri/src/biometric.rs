use crate::{
    State,
    crypto::{self, Key},
    database as db,
    error::{Error, Result, ensure},
};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub fn dispatch(app: &AppHandle, command: &str, args: &Value) -> Result<Value> {
    let state = app.state::<State>();
    if command == "get_biometric_status" {
        let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
        let db = vault.connection()?;
        let enabled = !db::rows(
            db,
            "SELECT key FROM vault_metadata WHERE key='biometric-rust'",
            [],
        )?
        .is_empty();
        let preferred = db::rows(
            db,
            "SELECT value FROM vault_metadata WHERE key='biometric-preferred'",
            [],
        )?
        .first()
        .is_some_and(|row| row["value"] == "true");
        let legacy = !db::rows(
            db,
            "SELECT key FROM vault_metadata WHERE key='biometric'",
            [],
        )?
        .is_empty();
        return Ok(
            json!({"label":if cfg!(windows){"Windows Hello"}else if cfg!(target_os="macos"){"Touch ID"}else{"生物识别"},"available":platform::available(),"enabled":enabled,"preferred":enabled && preferred,"needsReenrollment":legacy && !enabled}),
        );
    }
    if command == "disable_biometric" {
        let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
        vault.key()?;
        let db = vault.connection()?;
        if let Some(row) = db::rows(
            db,
            "SELECT value FROM vault_metadata WHERE key='biometric-rust'",
            [],
        )?
        .first()
        {
            platform::remove(&crypto::decode(
                row["value"].as_str().ok_or(Error("BIOMETRIC_INVALID"))?,
            )?)?;
        }
        db.execute("DELETE FROM vault_metadata WHERE key IN('biometric','biometric-rust','biometric-preferred')",[])?;
        return Ok(Value::Null);
    }
    ensure(platform::available(), "BIOMETRIC_UNAVAILABLE")?;
    let (epoch, metadata, key, stored) = {
        let vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
        let metadata = db::metadata(vault.connection()?)?.ok_or(Error("VAULT_NOT_FOUND"))?;
        if command == "enable_biometric" {
            vault.key()?;
            let password = crate::vault::password(args, "password")?;
            (
                vault.generation(),
                metadata,
                Some(vault.verify_password(&password)?),
                None,
            )
        } else {
            let row = db::rows(
                vault.connection()?,
                "SELECT value FROM vault_metadata WHERE key='biometric-rust'",
                [],
            )?
            .pop()
            .ok_or(Error("BIOMETRIC_UNAVAILABLE"))?;
            (
                vault.generation(),
                metadata,
                None,
                Some(crypto::decode(
                    row["value"].as_str().ok_or(Error("BIOMETRIC_INVALID"))?,
                )?),
            )
        }
    };
    platform::verify(app)?;
    let (key, protected) = if let Some(key) = key {
        let protected = platform::protect(&key)?;
        (key, Some(protected))
    } else {
        let key = platform::unprotect(&stored.ok_or(Error("BIOMETRIC_INVALID"))?)?;
        ensure(crypto::verify(&key, &metadata), "BIOMETRIC_INVALID")?;
        (key, None)
    };
    let mut vault = state.vault.lock().map_err(|_| Error("VAULT_BUSY"))?;
    if let Err(error) = vault.check_epoch(epoch) {
        if let Some(value) = &protected {
            let _ = platform::remove(value);
        }
        return Err(error);
    }
    let db = vault.connection()?;
    if let Some(protected) = protected {
        db.execute(
            "INSERT OR REPLACE INTO vault_metadata(key,value) VALUES('biometric-rust',?)",
            [crypto::encode(protected)],
        )?;
        db.execute("INSERT OR REPLACE INTO vault_metadata(key,value) VALUES('biometric-preferred','false')",[])?;
        db.execute("DELETE FROM vault_metadata WHERE key='biometric'", [])?;
    } else {
        db.execute(
            "INSERT OR REPLACE INTO vault_metadata(key,value) VALUES('biometric-preferred','true')",
            [],
        )?;
    }
    db.execute("DELETE FROM unlock_attempts", [])?;
    vault.adopt(key, epoch)?;
    Ok(Value::Null)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows::{
        Security::Credentials::UI::{
            UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
        },
        Win32::{
            Foundation::{HLOCAL, LocalFree},
            Security::Cryptography::{
                CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
            },
            System::WinRT::IUserConsentVerifierInterop,
        },
        core::{HSTRING, PCWSTR},
    };
    use zeroize::Zeroizing;
    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|operation| operation.join())
            .is_ok_and(|value| value == UserConsentVerifierAvailability::Available)
    }
    pub fn verify(app: &AppHandle) -> Result<()> {
        let window = app
            .get_webview_window("main")
            .ok_or(Error("BIOMETRIC_UNAVAILABLE"))?;
        let handle = windows::Win32::Foundation::HWND(
            window.hwnd().map_err(|_| Error("BIOMETRIC_UNAVAILABLE"))?.0,
        );
        let factory = windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
            .map_err(|_| Error("BIOMETRIC_UNAVAILABLE"))?;
        let operation: windows_future::IAsyncOperation<UserConsentVerificationResult> = unsafe {
            factory
                .RequestVerificationForWindowAsync(handle, &HSTRING::from("解锁 Keystill 保险库"))
        }
        .map_err(|_| Error("BIOMETRIC_CANCELED_OR_FAILED"))?;
        ensure(
            operation
                .join()
                .map_err(|_| Error("BIOMETRIC_CANCELED_OR_FAILED"))?
                == UserConsentVerificationResult::Verified,
            "BIOMETRIC_CANCELED_OR_FAILED",
        )
    }
    fn dpapi(input: &[u8], protect: bool) -> Result<Vec<u8>> {
        let mut input = Zeroizing::new(input.to_vec());
        let blob = CRYPT_INTEGER_BLOB {
            cbData: input.len() as u32,
            pbData: input.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            let result = if protect {
                CryptProtectData(
                    &blob,
                    PCWSTR::null(),
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &blob,
                    None,
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            };
            result.map_err(|_| Error("BIOMETRIC_INVALID"))?;
            let bytes = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
            let value = bytes.to_vec();
            if !protect {
                use zeroize::Zeroize;
                bytes.zeroize();
            }
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
            Ok(value)
        }
    }
    pub fn protect(key: &[u8; 32]) -> Result<Vec<u8>> {
        dpapi(key, true)
    }
    pub fn unprotect(bytes: &[u8]) -> Result<Key> {
        let bytes = Zeroizing::new(dpapi(bytes, false)?);
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| Error("BIOMETRIC_INVALID"))?;
        Ok(Zeroizing::new(key))
    }
    pub fn remove(_: &[u8]) -> Result<()> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2_foundation::NSString;
    use objc2_local_authentication::{LAContext, LAPolicy};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    use zeroize::Zeroizing;
    const SERVICE: &str = "com.jiazi.vault.tauri";
    pub fn available() -> bool {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok()
        }
    }
    pub fn verify(_: &AppHandle) -> Result<()> {
        let context = unsafe { LAContext::new() };
        let (send, receive) = std::sync::mpsc::channel();
        let reply = block2::RcBlock::new(
            move |success: objc2::runtime::Bool, _error: *mut objc2_foundation::NSError| {
                let _ = send.send(success.as_bool());
            },
        );
        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &NSString::from_str("解锁 Keystill 保险库"),
                &reply,
            );
        }
        ensure(
            receive
                .recv_timeout(std::time::Duration::from_secs(120))
                .unwrap_or(false),
            "BIOMETRIC_CANCELED_OR_FAILED",
        )
    }
    pub fn protect(key: &[u8; 32]) -> Result<Vec<u8>> {
        let id = crate::vault::id();
        set_generic_password(SERVICE, &id, key).map_err(|_| Error("BIOMETRIC_UNAVAILABLE"))?;
        Ok(id.into_bytes())
    }
    pub fn unprotect(bytes: &[u8]) -> Result<Key> {
        let id = std::str::from_utf8(bytes).map_err(|_| Error("BIOMETRIC_INVALID"))?;
        let value = Zeroizing::new(
            get_generic_password(SERVICE, id).map_err(|_| Error("BIOMETRIC_INVALID"))?,
        );
        Ok(Zeroizing::new(
            value
                .as_slice()
                .try_into()
                .map_err(|_| Error("BIOMETRIC_INVALID"))?,
        ))
    }
    pub fn remove(bytes: &[u8]) -> Result<()> {
        if let Ok(id) = std::str::from_utf8(bytes) {
            delete_generic_password(SERVICE, id).map_err(|_| Error("BIOMETRIC_INVALID"))?;
        }
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    pub fn available() -> bool {
        false
    }
    pub fn verify(_: &AppHandle) -> Result<()> {
        Err(Error("BIOMETRIC_UNAVAILABLE"))
    }
    pub fn protect(_: &[u8; 32]) -> Result<Vec<u8>> {
        Err(Error("BIOMETRIC_UNAVAILABLE"))
    }
    pub fn unprotect(_: &[u8]) -> Result<Key> {
        Err(Error("BIOMETRIC_UNAVAILABLE"))
    }
    pub fn remove(_: &[u8]) -> Result<()> {
        Ok(())
    }
}
