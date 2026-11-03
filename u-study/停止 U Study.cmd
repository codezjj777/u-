@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node launcher.mjs --stop
if errorlevel 1 pause
endlocal
