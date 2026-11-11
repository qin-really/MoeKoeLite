use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::windows;

/// 全局退出标记：置 true 后允许退出（托盘「退出」/ disclaimer 拒绝时）。
pub static QUITTING: AtomicBool = AtomicBool::new(false);
/// 最小化到托盘开关（默认 on，与 defaultSettings 一致）。
pub static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(true);
/// 外部 API 服务开关（默认 on）。
pub static API_MODE: AtomicBool = AtomicBool::new(true);

#[derive(Deserialize)]
pub struct WindowControlPayload {
    action: String,
}

#[tauri::command]
pub fn window_control(app: AppHandle, payload: WindowControlPayload) -> Result<(), String> {
    let win = main_window(&app)?;
    match payload.action.as_str() {
        "close" => {
            if !MINIMIZE_TO_TRAY.load(Ordering::Relaxed) {
                QUITTING.store(true, Ordering::SeqCst);
                let _ = app.exit(0);
            } else {
                let _ = win.hide();
            }
        }
        "minimize" => win.minimize().map_err(|e| e.to_string())?,
        "maximize" => {
            if win.is_maximized().unwrap_or(false) {
                win.unmaximize().map_err(|e| e.to_string())?;
            } else {
                win.maximize().map_err(|e| e.to_string())?;
            }
        }
        other => return Err(format!("unknown window-control action: {other}")),
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SaveSettingsPayload {
    settings: Value,
}

#[tauri::command]
pub fn save_settings(app: AppHandle, payload: SaveSettingsPayload) -> Result<(), String> {
    if let Some(v) = payload.settings.get("autoStart") {
        use tauri_plugin_autostart::ManagerExt;
        let autostart = app.autolaunch();
        if v == "on" {
            let _ = autostart.enable();
        } else {
            let _ = autostart.disable();
        }
    }
    if let Some(v) = payload.settings.get("minimizeToTray") {
        MINIMIZE_TO_TRAY.store(v == "on", Ordering::Relaxed);
    }
    if let Some(v) = payload.settings.get("apiMode") {
        API_MODE.store(v != "off", Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_settings(app: AppHandle) -> Result<(), String> {
    if let Ok(dir) = app.path().app_data_dir() {
        use tauri_plugin_opener::OpenerExt;
        let path_str = dir.to_string_lossy().to_string();
        let _ = app.opener().open_path(path_str, None::<&str>);
    }
    Ok(())
}

#[tauri::command]
pub fn open_mv_window(app: AppHandle, url: String) -> Result<bool, String> {
    windows::mv_navigate(&app, url).map_err(|e| e.to_string())?;
    let mv = windows::mv_window(&app).map_err(|e| e.to_string())?;
    mv.show().map_err(|e| e.to_string())?;
    mv.set_focus().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct LogPathResult {
    error: Option<String>,
}

#[tauri::command]
pub fn open_log_path(app: AppHandle) -> Result<LogPathResult, String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().or_else(|_| app.path().app_data_dir());
    match dir {
        Ok(dir) => {
            let path_str = dir.to_string_lossy().to_string();
            match app.opener().open_path(path_str, None::<&str>) {
                Ok(_) => Ok(LogPathResult { error: None }),
                Err(e) => Ok(LogPathResult { error: Some(e.to_string()) }),
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
pub struct ExportLogResult {
    canceled: bool,
}

#[tauri::command]
pub async fn export_log(app: AppHandle) -> Result<ExportLogResult, String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app.path().app_log_dir().or_else(|_| app.path().app_data_dir());
    let dir = dir.map_err(|e| e.to_string())?;
    let files = [
        dir.join("main.log"),
        dir.join("MoeKoeMusic.log"),
    ];
    let mut content = String::new();
    for f in files.iter().filter(|f| f.exists()) {
        if let Ok(c) = std::fs::read_to_string(f) {
            content.push_str(&c);
        }
    }
    if content.is_empty() {
        return Ok(ExportLogResult { canceled: true });
    }
    // 简单脱敏（主日志可能含 token/key/mobile 等）
    let cleaned = sanitize_log(&content);
    let file = app
        .dialog()
        .file()
        .set_title("导出日志")
        .add_filter("Log", &["log"])
        .blocking_save_file();
    let Some(file) = file else {
        return Ok(ExportLogResult { canceled: true });
    };
    let dest = file.into_path().map_err(|e| e.to_string())?;
    std::fs::write(dest, cleaned).map_err(|e| e.to_string())?;
    Ok(ExportLogResult { canceled: false })
}

#[derive(Serialize)]
pub struct ApiEndpoint {
    http: String,
    ws: String,
}

#[tauri::command]
pub fn get_api_service_endpoint() -> Option<ApiEndpoint> {
    if !API_MODE.load(Ordering::Relaxed) {
        return None;
    }
    Some(ApiEndpoint {
        http: "http://127.0.0.1:6520".into(),
        ws: "ws://127.0.0.1:6520/moekoe".into(),
    })
}

#[derive(Serialize)]
pub struct PointerState {
    cursor: serde_json::Map<String, Value>,
    bounds: serde_json::Map<String, Value>,
}

#[tauri::command]
pub fn lyrics_pointer_state(app: AppHandle) -> Option<PointerState> {
    let (pos, (w, h)) = windows::lyrics_pointer_bounds(&app).ok()?;
    // cursor = 全局鼠标坐标（GetCursorPos），供歌词窗按屏幕坐标做"悬浮歌词命中"检测
    let (cx, cy) = windows::global_cursor_pos().unwrap_or((0, 0));
    let cursor = serde_json::json!({
        "x": cx,
        "y": cy,
    });
    let bounds = serde_json::json!({
        "x": pos.x,
        "y": pos.y,
        "width": w,
        "height": h,
    });
    Some(PointerState {
        cursor: cursor.as_object()?.clone(),
        bounds: bounds.as_object()?.clone(),
    })
}

#[tauri::command]
pub fn lyrics_fixed_size(app: AppHandle, width: f64, height: f64, fixed: bool) -> Result<(), String> {
    let lyrics = windows::lyrics_window(&app).map_err(|e| e.to_string())?;
    if fixed {
        lyrics
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        lyrics
            .set_min_size(Some(tauri::LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
        lyrics
            .set_max_size(Some(tauri::LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    } else if let Ok(Some(monitor)) = lyrics.current_monitor() {
        let wa = monitor.work_area();
        let (mw, mh) = (wa.size.width as f64, wa.size.height as f64);
        lyrics
            .set_max_size(Some(tauri::LogicalSize::new(mw, mh)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// —— 事件桥分发（模拟 Electron ipcMain.on 的通道） ——
pub fn dispatch_bus(app: &AppHandle, payload: Value) {
    let channel = payload
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or_default();
    let args = payload
        .get("args")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    match channel {
        "disclaimer-response" => {
            let accepted = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            if !accepted {
                QUITTING.store(true, Ordering::SeqCst);
                let _ = app.exit(0);
            }
        }
        "window-control" => {
            let _ = window_control(app.clone(), WindowControlPayload {
                action: args.first().and_then(|v| v.as_str()).unwrap_or("").to_string(),
            });
        }
        "save-settings" => {
            if let Some(s) = args.first() {
                let _ = save_settings(app.clone(), SaveSettingsPayload { settings: s.clone() });
            }
        }
        "clear-settings" => {
            let _ = clear_settings(app.clone());
        }
        "lyrics-data" => {
            if let Some(d) = args.first() {
                let _ = windows::emit_to_lyrics(app, "lyrics-data", d.clone());
            }
        }
        "server-lyrics" => { /* WS 歌词广播在 sidecar 化中可选，本轮忽略 */ }
        "desktop-lyrics-action" => {
            if let Some(a) = args.first().and_then(|v| v.as_str()) {
                windows::handle_lyrics_action(app, a);
            }
        }
        "set-ignore-mouse-events" => {
            let ignore = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            let forward = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            let _ = windows::lyrics_set_ignore_cursor(app, ignore, forward);
        }
        "lyrics-lock-state" => {
            // 歌词窗前端锁定/解锁 → 同步托盘菜单文本
            let locked = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            crate::tray::set_lyrics_lock(app, locked);
        }
        "window-drag" => {
            if let Some(o) = args.first().and_then(|v| v.as_object()) {
                let x = o.get("x").and_then(|v| v.as_f64());
                let y = o.get("y").and_then(|v| v.as_f64());
                let w = o.get("width").and_then(|v| v.as_f64());
                let h = o.get("height").and_then(|v| v.as_f64());
                let _ = windows::move_lyrics_window(app, x, y, w, h);
            }
        }
        "lyrics-window-fixed-size" => {
            if let Some(o) = args.first().and_then(|v| v.as_object()) {
                let width = o.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let height = o.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let fixed = o.get("fixed").and_then(|v| v.as_bool()).unwrap_or(false);
                let _ = lyrics_fixed_size(app.clone(), width, height, fixed);
            }
        }
        "play-pause-action" => {
            let playing = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            let current_time = args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let _ = windows::emit_to_lyrics(app, "playing-status", Value::Bool(playing));
            crate::tray::update_playback_state(app, playing, current_time);
        }
        "open-url" => {
            if let Some(url) = args.first().and_then(|v| v.as_str()) {
                let _ = open_url(app.clone(), url.to_string());
            }
        }
        "set-tray-title" => {
            if let Some(title) = args.first().and_then(|v| v.as_str()) {
                if let Ok(main) = main_window(app) {
                    let _ = main.set_title(title);
                }
            }
        }
        // 自定义托盘浮窗相关通道：本轮原生托盘，忽略
        "tray-menu-ready" | "tray-menu-hide" | "tray-menu-action" | "tray-menu-rendered"
        | "current-song-updated" | "lyrics-data-broadcast" => {}
        _ => {}
    }
}

/// 窗口全部关闭时是否允许退出（托盘常驻语义）。
pub fn should_deny_exit(app: &AppHandle) -> bool {
    let _ = app;
    MINIMIZE_TO_TRAY.load(Ordering::Relaxed) && !QUITTING.load(Ordering::SeqCst)
}

pub fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "main window not found".into())
}

fn sanitize_log(content: &str) -> String {
    let mut out = content.to_string();
    for (re, sub) in [
        (r#"(?i)(mobile)=[0-9]{6,}"#, "$1=***"),
        (r#"(?i)(token)=[A-Za-z0-9]+"#, "$1=***"),
        (r#"(?i)(key)=[A-Za-z0-9]+"#, "$1=***"),
        (r#"(?i)(userid)=\d+"#, "$1=***"),
        (r#"(?i)(username)=[^\s&]+"#, "$1=***"),
        (r#"(?i)(password)=[^\s&]+"#, "$1=***"),
    ] {
        // 无 regex 依赖的朴素脱敏：仅替换形如 `key=` 后的完整 token（不跨行）
        let prefix = re.split('=').next().unwrap_or(re);
        let prefix_lower = prefix.to_lowercase();
        out = replace_key_value(&out, &prefix_lower, sub);
        let _ = &re;
    }
    out
}

/// 朴素替换 `key=value`（value 到空白/逗号/& 或行尾）。
fn replace_key_value(content: &str, key_lower: &str, marker: &str) -> String {
    let needle = format!("{key_lower}=");
    let mut result = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(idx) = rest.to_lowercase().find(&needle) {
        result.push_str(&rest[..idx + needle.len()]);
        let after = &rest[idx + needle.len()..];
        let take = after
            .find(|c: char| c.is_whitespace() || c == '&' || c == ';' || c == ',')
            .unwrap_or(after.len());
        result.push_str(marker);
        result.push_str(&after[take..]);
        rest = &after[take..];
    }
    result.push_str(rest);
    result
}