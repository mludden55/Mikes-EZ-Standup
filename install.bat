@echo off
cd /d "%~dp0"
echo Installing required packages (npm install)...
call npm install --omit=dev
if errorlevel 1 (echo npm install failed. Is Node.js installed? & pause & exit /b 1)
node install\install-server.js
pause
