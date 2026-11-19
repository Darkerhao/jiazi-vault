use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{
    NSDistributedNotificationCenter, NSNotification, NSNotificationCenter, NSObjectProtocol,
    NSString,
};
use std::{cell::RefCell, ptr::NonNull};
use tauri::AppHandle;

thread_local! {
    static OBSERVERS:RefCell<Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>>=const {RefCell::new(Vec::new())};
}
fn observe(app: &AppHandle, center: &NSNotificationCenter, name: &str) {
    let handle = app.clone();
    let callback = block2::RcBlock::new(move |_notification: NonNull<NSNotification>| {
        crate::desktop::lock(&handle)
    });
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(&NSString::from_str(name)),
            None,
            None,
            &callback,
        )
    };
    OBSERVERS.with(|tokens| tokens.borrow_mut().push(token));
}
pub fn register(app: &AppHandle) {
    let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
    observe(app, &workspace, "NSWorkspaceWillSleepNotification");
    let distributed = NSDistributedNotificationCenter::defaultCenter();
    observe(app, &distributed, "com.apple.screenIsLocked");
}
