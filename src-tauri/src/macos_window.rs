//! macOS 圆角来自带标题的 Overlay 窗口。改成 borderless 后窗口变直角，
//! 页面里的 CSS 圆角就会叠成第二层。这里把样式蒙版设回 Overlay，并藏起系统交通灯。

use std::ffi::c_void;

use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool};

const TITLED: usize = 1 << 0;
const CLOSABLE: usize = 1 << 1;
const MINIATURIZABLE: usize = 1 << 2;
const RESIZABLE: usize = 1 << 3;
const FULL_SCREEN: usize = 1 << 14;
const FULL_SIZE_CONTENT_VIEW: usize = 1 << 15;
const OVERLAY_MASK: usize = TITLED | CLOSABLE | MINIATURIZABLE | RESIZABLE | FULL_SIZE_CONTENT_VIEW;
const TITLE_HIDDEN: isize = 1;

pub fn restore_overlay_frame(ns_window_ptr: *mut c_void) {
    if ns_window_ptr.is_null() {
        return;
    }
    let ns_window = unsafe { &*ns_window_ptr.cast::<AnyObject>() };
    let current: usize = unsafe { msg_send![ns_window, styleMask] };
    if current & FULL_SCREEN == 0 && current != OVERLAY_MASK {
        let _: () = unsafe { msg_send![ns_window, setStyleMask: OVERLAY_MASK] };
        let _: () = unsafe { msg_send![ns_window, setTitlebarAppearsTransparent: Bool::YES] };
        let _: () = unsafe { msg_send![ns_window, setTitleVisibility: TITLE_HIDDEN] };
        let _: () = unsafe { msg_send![ns_window, setHasShadow: Bool::YES] };
        let content: Option<&AnyObject> = unsafe { msg_send![ns_window, contentView] };
        if let Some(content) = content {
            let _: Bool = unsafe { msg_send![ns_window, makeFirstResponder: content] };
        }
    }
    hide_native_traffic_lights(ns_window);
}

fn hide_native_traffic_lights(ns_window: &AnyObject) {
    // Close = 0, Miniaturize = 1, Zoom = 2, FullScreen = 7.
    for kind in [0usize, 1, 2, 7] {
        let button: Option<&AnyObject> = unsafe { msg_send![ns_window, standardWindowButton: kind] };
        if let Some(button) = button {
            let _: () = unsafe { msg_send![button, setHidden: Bool::YES] };
        }
    }
}

