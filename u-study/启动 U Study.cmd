@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20.19 或更新版本，再重新启动。
  pause
  exit /b 1
)
node --input-type=module -e "import {assertRuntime} from './runtime-check.mjs'; assertRuntime();"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "node_modules\playwright-core\package.json" (
  echo 正在准备程序依赖，请稍候...
  call npm.cmd ci --omit=dev --cache .cache/npm --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装未完成，请检查网络后重试。
    pause
    exit /b 1
  )
)
node launcher.mjs --all %*
set "ustudy_exit=%errorlevel%"
if not "%ustudy_exit%"=="0" pause
exit /b %ustudy_exit%
