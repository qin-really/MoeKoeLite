use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

fn not_found(_label: &str) -> tauri::Error {
    tauri::Error::WindowNotFound
}

/// 窗口 setup：窗口初始状态。位置持久化简化为居中（原 electron-store 由前端 localStorage 承担）。
pub fn setup_windows(app: &AppHandle) -> tauri::Result<()> {
    let main = app.get_webview_window("main");
    if let Some(main) = &main {
        let _ = main.center();
    }
    if let Some(lyrics) = app.get_webview_window("lyrics") {
        let _ = lyrics.hide();
    }
    if let Some(mv) = app.get_webview_window("mv") {
        let _ = mv.hide();
    }
    Ok(())
}

pub fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main").ok_or_else(|| not_found("main"))
}

pub fn lyrics_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("lyrics").ok_or_else(|| not_found("lyrics"))
}

pub fn mv_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("mv").ok_or_else(|| not_found("mv"))
}

/// 事件定向发给歌词窗（对齐 lyricsWindow.webContents.send）
pub fn emit_to_lyrics(app: &AppHandle, event: &str, payload: serde_json::Value) -> tauri::Result<()> {
    if let Ok(w) = lyrics_window(app) {
        w.emit(event, payload)?;
    }
    Ok(())
}

/// 事件定向发给主窗（对齐 mainWindow.webContents.send）
pub fn emit_to_main(app: &AppHandle, event: &str, payload: serde_json::Value) -> tauri::Result<()> {
    if let Ok(w) = main_window(app) {
        w.emit(event, payload)?;
    }
    Ok(())
}

/// 桌面歌词操作（desktop-lyrics-action）
pub fn handle_lyrics_action(app: &AppHandle, action: &str) {
    match action {
        "previous-song" | "next-song" | "toggle-play" => {
            let ev = match action {
                "previous-song" => "play-previous-track",
                "next-song" => "play-next-track",
                _ => "toggle-play-pause",
            };
            let _ = emit_to_main(app, ev, serde_json::Value::Null);
        }
        "close-lyrics" => {
            if let Ok(w) = lyrics_window(app) {
                let _ = w.hide();
            }
            let _ = emit_to_main(app, "desktop-lyrics-state", serde_json::json!({ "on": false }));
        }
        "display-lyrics" => {
            // 不强制居中：位置由前端按持久化恢复决定（有保存位置 → 保持原位置；
            // 无保存位置 → 前端居中一次），保证"关闭再开启"回到持久化状态
            if let Ok(w) = lyrics_window(app) {
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = emit_to_main(app, "desktop-lyrics-state", serde_json::json!({ "on": true }));
        }
        "display-lyrics-nocenter" => {
            // 恢复持久位置时显示：不居中（位置由前端按歌词窗本地缓存恢复），仅 show+focus
            if let Ok(w) = lyrics_window(app) {
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = emit_to_main(app, "desktop-lyrics-state", serde_json::json!({ "on": true }));
        }
        _ => {}
    }
}

/// 歌词窗鼠标穿透（Electron setIgnoreMouseEvents(ignore, {forward:true})）
pub fn lyrics_set_ignore_cursor(app: &AppHandle, ignore: bool, _forward: bool) -> tauri::Result<()> {
    if let Ok(w) = lyrics_window(app) {
        w.set_ignore_cursor_events(ignore)?;
    }
    Ok(())
}

/// 拖动歌词窗（window-drag）
pub fn move_lyrics_window(
    app: &AppHandle,
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
) -> tauri::Result<()> {
    if let Ok(win) = lyrics_window(app) {
        if let (Some(x), Some(y)) = (x, y) {
            win.set_position(LogicalPosition::new(x, y))?;
        }
        if let (Some(w), Some(h)) = (w, h) {
            win.set_size(LogicalSize::new(w, h))?;
        }
    }
    Ok(())
}

/// MV 窗口加载 URL（open-mv-window）
pub fn mv_navigate(app: &AppHandle, url: String) -> tauri::Result<()> {
    let mv = mv_window(app)?;
    let parsed: tauri::Url = url.parse().map_err(tauri::Error::InvalidUrl)?;
    mv.navigate(parsed)?;
    Ok(())
}

/// 歌词窗指针位置 + bounds（供 Lyrics.vue 计算 hover 命中）
pub fn lyrics_pointer_bounds(app: &AppHandle) -> tauri::Result<(PhysicalPosition<i32>, (u32, u32))> {
    let w = lyrics_window(app)?;
    let pos = w.outer_position()?;
    let size = w.outer_size()?;
    Ok((pos, (size.width, size.height)))
}

/// 全局鼠标坐标（屏幕物理坐标），歌词窗穿透时用于"悬浮在歌词文字上才指向"的命中判定
pub fn global_cursor_pos() -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut pt = POINT { x: 0, y: 0 };
        // SAFETY: 传入了有效 POINT 栈指针，GetCursorPos 失败返回 0
        let ok = unsafe { GetCursorPos(&mut pt) };
        if ok != 0 {
            return Some((pt.x, pt.y));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        return None;
    }
    #[cfg(target_os = "windows")]
    {
        None
    }
}