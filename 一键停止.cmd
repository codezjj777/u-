@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
call "%~dp0u-study\停止 U Study.cmd" %*
exit /b %errorlevel%
