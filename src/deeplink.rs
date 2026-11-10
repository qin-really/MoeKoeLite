use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// 注册 moekoe:// 深链并监听打开事件。
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    // 将当前应用注册为 moekoe:// 的处理器（tauri-plugin-deep-link，Windows 写注册表）
    let _ = app.deep_link().register_all();
    // 监听可能已在启动阶段发生的打开（deep-link 插件在启动即回调所有 pending urls）
    let handle = app.clone();
    let _ = app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_incoming(&handle, url);
        }
    });
    Ok(())
}

fn handle_incoming(app: &AppHandle, raw_url: tauri::Url) {
    // moekoe://team/join?code=xxx
    let scheme = raw_url.scheme();
    if scheme != "moekoe" {
        return;
    }
    let url_path = raw_url.path().trim_start_matches('/').to_string();
    let teamcode: String = raw_url
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .unwrap_or_default();

    let payload = serde_json::json!({
        "teamcode": teamcode,
        "urlPath": url_path,
    });

    // 主窗就绪后再推；若尚未加载，延迟重试（对齐 sendHashAfterLoad 的双保险）
    let app = app.clone();
    let _ = crate::windows::emit_to_main(&app, "url-params", payload.clone());
    // 若主窗还没创建完成，深链可能丢失 —— 该场景由前端在加载完成后主动兜底协商。
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}