//! Native session notifications; no polling process and no .NET helper.
use crate::error::{Error, Result};
use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::RemoteDesktop::WTSRegisterSessionNotification,
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WM_NCDESTROY, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE},
    },
};

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    let app = unsafe { &*(data as *const AppHandle) };
    // WTS_SESSION_LOCK=7; PBT_APMSUSPEND=4. Invalidate before an authentication can commit.
    if message == WM_WTSSESSION_CHANGE && wparam.0 == 7
        || message == WM_POWERBROADCAST && wparam.0 == 4
    {
        crate::desktop::lock(app);
    }
    if message == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(window_proc), 1) };
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        drop(unsafe { Box::from_raw(data as *mut AppHandle) });
        return result;
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}
pub fn register(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or(Error("DESKTOP_SETUP_FAILED"))?;
    let handle = HWND(window.hwnd().map_err(|_| Error("DESKTOP_SETUP_FAILED"))?.0);
    // Called from Tauri's main-thread setup, as required by SetWindowSubclass.
    unsafe {
        WTSRegisterSessionNotification(handle, 0).map_err(|_| Error("DESKTOP_SETUP_FAILED"))?;
        let data = Box::into_raw(Box::new(app.clone()));
        if !SetWindowSubclass(handle, Some(window_proc), 1, data as usize).as_bool() {
            drop(Box::from_raw(data));
            return Err(Error("DESKTOP_SETUP_FAILED"));
        }
    }
    Ok(())
}
