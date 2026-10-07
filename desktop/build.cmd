@echo off
setlocal
cd /d "%~dp0"
title Build Mike's EZ Standup desktop app

where dotnet >nul 2>nul
if errorlevel 1 goto nosdk

echo.
echo  Building Mike's EZ Standup desktop app...
echo.
dotnet build MikesEZStandup.csproj -c Release -nologo
if errorlevel 1 goto failed

set "OUT=%~dp0..\installers\desktop"
if not exist "%OUT%" mkdir "%OUT%"
if exist "%OUT%\app" rmdir /s /q "%OUT%\app"
xcopy "%~dp0bin\Release\*" "%OUT%\app\" /e /i /q /y >nul

echo  Packaging MikesEZStandup-Desktop.zip...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$o = (Resolve-Path '%OUT%').Path; $items = @(Join-Path $o 'app'); foreach ($f in 'Install-Desktop-Windows.bat','Uninstall-Desktop-Windows.bat','MikesEZStandup.json','README.txt') { $p = Join-Path $o $f; if (Test-Path $p) { $items += $p } }; Compress-Archive -Path $items -DestinationPath (Join-Path $o 'MikesEZStandup-Desktop.zip') -Force"
if errorlevel 1 goto failed

echo.
echo  Done. The desktop app is in installers\desktop
echo    - app\MikesEZStandup.exe          the program
echo    - MikesEZStandup-Desktop.zip      what workers download from /downloads
echo    - Install-Desktop-Windows.bat     installs it from a network share
echo.
pause
exit /b 0

:nosdk
echo.
echo  The .NET SDK is not installed on this PC.
echo  Download the free ".NET SDK" - version 8 or newer - from:
echo      https://dotnet.microsoft.com/download
echo  Install it, close this window, then run build.cmd again.
echo.
pause
exit /b 1

:failed
echo.
echo  The build did not finish. Scroll up for the first error message.
echo.
pause
exit /b 1
