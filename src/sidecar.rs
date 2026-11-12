use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg_attr(debug_assertions, allow(unused_imports))]
use tauri::{AppHandle, Manager};

/// sidecar 子进程句柄（退出时回收）
pub static SIDECAR: Mutex<Option<Child>> = Mutex::new(None);

pub const SIDECAR_PORT: &str = "6520";
pub const SIDECAR_HOST: &str = "127.0.0.1";

/// sidecar 根目录：
///   dev  —— $CARGO_MANIFEST_DIR/sidecar（源码目录，副产物不入 target）
///   prod —— resource_dir/sidecar（打包时随 resources 分发）
pub fn sidecar_dir(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let _ = app; // dev 阶段直接引用源码目录
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar")
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("sidecar")
    }
}

/// 从给定目录拉起 sidecar 子进程（共用实现；成功持有句柄返回 true）
fn spawn_from(dir: &std::path::Path) -> bool {
    let node = dir.join("node.exe");
    let entry = dir.join("kugoumusicapi").join("app.js");
    if !node.exists() || !entry.exists() {
        eprintln!(
            "[sidecar] 未找到运行时(node.exe)或入口(app.js)于 {}，跳过自动启动",
            dir.display()
        );
        return false;
    }

    let mut cmd = Command::new(&node);
    // Windows: 不弹出控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // 关键：node 入口用「cwd 相对路径 app.js」，避免 Windows 下绝对路径传参被 node 模块解析
        // 误析成盘符 `D:`（报 `EISDIR: lstat 'D:'` 后直接退出）。
        // current_dir 已设为 kugoumusicapi 目录，相对入口天然正确。
        cmd.arg("app.js")
        .arg(format!("--port={SIDECAR_PORT}"))
        .arg(format!("--host={SIDECAR_HOST}"))
        // 对齐 Electron 主进程 init.js：dataSource=concept → platform='lite'
        // （否则官方 server 注入 KUGOU_API_PLATFORM='undefined'，酷狗返回受限数据）
        .env("platform", "lite")
        .env("KUGOU_API_PLATFORM", "lite")
        .current_dir(dir.join("kugoumusicapi"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            // 消费子进程输出，防止管道缓冲阻塞
            if let Some(stdout) = child.stdout.take() {
                std::thread::spawn(move || {
                    use std::io::Read;
                    let mut reader = std::io::BufReader::new(stdout);
                    let mut buf = [0u8; 4096];
                    while let Ok(n) = reader.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        #[cfg(debug_assertions)]
                        eprint!("[api] {}", String::from_utf8_lossy(&buf[..n]));
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                std::thread::spawn(move || {
                    use std::io::Read;
                    let mut reader = std::io::BufReader::new(stderr);
                    let mut buf = [0u8; 4096];
                    while let Ok(n) = reader.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        eprint!("[api:err] {}", String::from_utf8_lossy(&buf[..n]));
                    }
                });
            }
            let cid = child.id();
            *SIDECAR.lock().unwrap() = Some(child);
            // 存活检查：1.2s 后确认仍在运行（借锁 try_wait，仍运行则放回）
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                let mut guard = SIDECAR.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    match child.try_wait() {
                        Ok(Some(status)) => eprintln!("[sidecar] 启动后即退出 code={:?}", status.code()),
                        Ok(None) => {
                            eprintln!("[sidecar] 运行中 pid={cid}");
                            *guard = Some(child);
                        }
                        Err(e) => {
                            eprintln!("[sidecar] wait err {e}");
                            *guard = Some(child);
                        }
                    }
                }
            });
            eprintln!(
                "[sidecar] 已启动 kugoumusicapi @ {}:{}",
                SIDECAR_HOST, SIDECAR_PORT
            );
            true
        }
        Err(e) => {
            eprintln!("[sidecar] 启动失败: {e}");
            false
        }
    }
}

/// 设备目录候选（不依赖 AppHandle，供早启使用）：
///   1. release：当前 exe 同级 sidecar/（免安装版布局：exe 与 sidecar 同目录）
///   2. 任意模式：$CARGO_MANIFEST_DIR/sidecar（源码/开发布局）
/// 若以上均不命中（如安装包资源目录不落在这两处），早启静默失败，
/// 由 setup() 的 ensure_running 按 resource_dir 兜底，行为等价于改造前。
fn sidecar_candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(not(debug_assertions))]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("sidecar"));
        }
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar"));
    dirs
}

/// 早启：在 run() 最开头（窗口/WebView2 初始化之前）拉起 sidecar，
/// node 启动与 tauri 初始化并行，后端尽早就绪。已拉起则直接返回；
/// 失败/布局不支持时静默，交给 ensure_running 兜底。
pub fn spawn_early() {
    if SIDECAR.lock().unwrap().is_some() {
        return;
    }
    for dir in sidecar_candidate_dirs() {
        if spawn_from(&dir) {
            return;
        }
    }
}

/// 确保 kugoumusicapi sidecar 在跑（只启一次；不存在二进制则静默跳过，便于先手工联调）
pub fn ensure_running(app: &AppHandle) {
    if SIDECAR.lock().unwrap().is_some() {
        return;
    }
    let dir = sidecar_dir(app);
    let _ = spawn_from(&dir);
}

/// 后台探测 6520 端口就绪（最多约 40s），就绪后触发回调。
/// 用于向前端广播「后端已就绪」，让页面在启动早期用缓存渲染、就绪后刷新。
pub fn once_ready(cb: impl FnOnce() + Send + 'static) {
    std::thread::spawn(move || {
        let host: &str = SIDECAR_HOST;
        let port: u16 = SIDECAR_PORT.parse().unwrap_or(6520);
        for _ in 0..200 {
            if std::net::TcpStream::connect((host, port)).is_ok() {
                cb();
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    });
}

/// 退出时回收
pub fn shutdown() {
    if let Some(mut child) = SIDECAR.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}