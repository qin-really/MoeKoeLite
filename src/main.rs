// 防止 Windows 下出现控制台窗口（release 生效）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    moekoekellite_lib::run()
}