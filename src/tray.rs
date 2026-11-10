use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands;

/// 托盘建立（原生菜单，6 项语义与精简后 customTrayMenuService 一致）
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;

    // 菜单项
    let show_hide = MenuItem::with_id::<_, _, _, &str>(app, "show-hide", "显示/隐藏", true, None)?;
    let prev = MenuItem::with_id::<_, _, _, &str>(app, "prev-track", "上一曲", true, None)?;
    let play = MenuItem::with_id::<_, _, _, &str>(app, "toggle-play-pause", "暂停/播放", true, None)?;
    let next = MenuItem::with_id::<_, _, _, &str>(app, "next-track", "下一曲", true, None)?;
    let quit = MenuItem::with_id::<_, _, _, &str>(app, "quit", "退出", true, None)?;
    let menu = Menu::with_items(app, &[&show_hide, &prev, &play, &next, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("MoeKoe Music")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-hide" => toggle_main_window(app),
            "prev-track" => send_to_main(app, "play-previous-track"),
            "toggle-play-pause" => send_to_main(app, "toggle-play-pause"),
            "next-track" => send_to_main(app, "play-next-track"),
            "quit" => {
                commands::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
                let _ = app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(false) {
            let _ = main.hide();
        } else {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

fn send_to_main(app: &AppHandle, event: &str) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(event, serde_json::Value::Null);
    }
}

/// 同步播放状态（原生菜单无进度显示，仅当托盘 tooltip 需要时补。）
#[allow(dead_code)]
pub fn update_playback_state(_app: &AppHandle, _is_playing: bool, _current_time: f64) {
    // 预留：后续改用 set_tooltip 展示曲目（本轮降级）
}

