@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if exist "%~dp0..\runtime\node.exe" set "PATH=%~dp0..\runtime;%PATH%"
node speech-setup.mjs
set "ustudy_speech_exit=%errorlevel%"
pause
exit /b %ustudy_speech_exit%
