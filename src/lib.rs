use serde_json::Value;
use tauri::Listener;

mod commands;
mod deeplink;
mod sidecar;
mod tray;
mod windows;

/// 前端 `window.electron.ipcRenderer.send(channel, ...args)` → 本会话路。
/// Tauri 的 emit 承载 `Vec<Value>`（多参数展开），由本函数统一分发，行为对齐 Electron ipcMain.
pub const FS_RUST_BUS: &str = "bridge:front_to_rust"; // 前端 → 壳事件总线

pub fn run() {
    // exe 启动立即并行拉起 sidecar（node 与 tauri/WebView2 初始化同步进行，互不等待）
    sidecar::spawn_early();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        // 单实例：第二个实例启动时被立刻感知，直接激活已运行实例的主窗后退出
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager as _;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::window_control,
            commands::save_settings,
            commands::clear_settings,
            commands::open_mv_window,
            commands::open_url,
            commands::open_log_path,
            commands::export_log,
            commands::get_api_service_endpoint,
            commands::lyrics_pointer_state,
            commands::lyrics_fixed_size,
        ])
        .setup(|app| {
            // 1) 浏览器侧 → 壳的事件桥（模拟 Electron 主进程 ipcMain.on）
            let handle = app.handle().clone();
            let bus = FS_RUST_BUS.to_string();
            let bus_handle = handle.clone();
            app.listen(&bus, move |event| {
                let raw = event.payload();
                if let Ok(v) = serde_json::from_str::<Value>(raw) {
                    commands::dispatch_bus(&bus_handle, v);
                }
            });

            // 2) 功能模块初始化
            deeplink::setup(&handle)?;
            windows::setup_windows(&handle)?;
            tray::setup(&handle)?;
            sidecar::ensure_running(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager as _;
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if commands::should_deny_exit(window.app_handle()) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // 播放语义：主窗口关闭 → 隐藏到托盘（minimizeToTray 默认 on）；退出才真正销毁
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if commands::should_deny_exit(app_handle) {
                    api.prevent_exit();
                }
                let _ = code;
            }
            tauri::RunEvent::Exit => {
                sidecar::shutdown();
            }
            _ => {}
        });
}

// 事件总线规范：{ channel: "window-control", args: [...] }
// 兼容层把 ipcRenderer.send 的每个参数压入 args，Rust 端 dispatch_bus 分发。