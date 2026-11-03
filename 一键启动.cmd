@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
call "%~dp0u-study\启动 U Study.cmd" %*
exit /b %errorlevel%
