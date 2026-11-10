# register-deeplink.ps1
# tauri-plugin-deep-link：Windows dev 模式下需手动注册 moekoe:// 协议（打包安装后由 NSIS 自动注册，无需此脚本）。
# 用法：powershell -ExecutionPolicy Bypass -File src-tauri/scripts/register-deeplink.ps1
$ErrorActionPreference = 'Stop'

$scheme = 'moekoe'
$exe = Join-Path $PWD 'src-tauri\target\debug\moekoemusic.exe'

if (-not (Test-Path $exe)) {
    Write-Warning "未找到 dev 可执行文件 $exe 。请先执行 pnpm tauri dev 编译过一次，再运行本脚本。"
}

# HKCU\Software\Classes\moekoe
$classesRoot = "HKEY_CURRENT_USER\Software\Classes\$scheme"
if (-not (Test-Path "Registry::$classesRoot")) {
    New-Item -Path "Registry::$classesRoot" -Force | Out-Null
}
New-ItemProperty -Path "Registry::$classesRoot" -Name '(default)' -Value 'URL:MoeKoe Music Protocol' -PropertyType String -Force | Out-Null
New-ItemProperty -Path "Registry::$classesRoot" -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$cmd = "$classesRoot\shell\open\command"
if (-not (Test-Path "Registry::$cmd")) {
    New-Item -Path "Registry::$cmd" -Force | Out-Null
}
New-ItemProperty -Path "Registry::$cmd" -Name '(default)' -Value "`"$exe`" `"%1`"" -PropertyType String -Force | Out-Null

Write-Host "✓ moekoe:// 已注册（dev） -> $exe"
Write-Host "  测试: cmd /c start moekoe://team/join?code=test12345"