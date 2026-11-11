use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands;

/// 桌面歌词锁定标记（仅作状态记录；托盘菜单固定为「解锁歌词」，点击即解锁）
static LYRICS_LOCKED: AtomicBool = AtomicBool::new(false);

/// 托盘建立：原生菜单（固定功能：显示/隐藏、上一曲、**暂停**、下一曲、**解锁歌词**、退出）
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;

    // 固定菜单项（不动态文字）：「暂停」「解锁歌词」为固定动作
    let show_hide = MenuItem::with_id::<_, _, _, &str>(app, "show-hide", "显示/隐藏", true, None)?;
    let prev = MenuItem::with_id::<_, _, _, &str>(app, "prev-track", "上一曲", true, None)?;
    let pause = MenuItem::with_id::<_, _, _, &str>(app, "pause-playback", "暂停", true, None)?;
    let next = MenuItem::with_id::<_, _, _, &str>(app, "next-track", "下一曲", true, None)?;
    let lyrics_unlock = MenuItem::with_id::<_, _, _, &str>(app, "lyrics-unlock", "解锁歌词", true, None)?;
    let quit = MenuItem::with_id::<_, _, _, &str>(app, "quit", "退出", true, None)?;
    let menu = Menu::with_items(app, &[&show_hide, &prev, &pause, &next, &lyrics_unlock, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("MoeKoe Lite")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-hide" => toggle_main_window(app),
            "prev-track" => send_to_main(app, "play-previous-track"),
            "pause-playback" => send_to_main(app, "pause-playback"), // 固定：暂停（主窗监听 'pause-playback'）
            "next-track" => send_to_main(app, "play-next-track"),
            "lyrics-unlock" => unlock_lyrics(app), // 固定：解锁歌词
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

/// 固定「解锁歌词」：解除歌词窗鼠标穿透（点击后窗口可交互/拖动）
fn unlock_lyrics(app: &AppHandle) {
    LYRICS_LOCKED.store(false, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("lyrics") {
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.emit("lyrics-lock-state", serde_json::json!(false));
    }
}

/// 歌词窗前端锁定状态同步（歌词窗内锁定/解锁时调用；菜单固定「解锁歌词」，仅记录状态，
/// 不参与菜单文字动态切换）
pub fn set_lyrics_lock(app: &AppHandle, locked: bool) {
    LYRICS_LOCKED.store(locked, Ordering::SeqCst);
    // 歌词窗前端自身会 set_ignore_cursor_events；此处仅需记录/兼容托盘入口
    let _ = app;
}

/// 兼容旧调用方（play-pause-action 分支）：托盘已不做播放状态展示，静默
#[allow(dead_code)]
pub fn update_playback_state(_app: &AppHandle, _is_playing: bool, _current_time: f64) {}