'use strict';
// Writes the Worker and Admin client installers (desktop shortcuts that open the
// right portal) with this server's address baked in.
const fs = require('fs');
const path = require('path');
const { paths, APP_NAME } = require('../server/config');

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

function windowsBat(name, url) {
  return crlf(`@echo off
setlocal
title Install ${name}
set "APPURL=${url}"
set "APPNAME=${name}"
for /f "usebackq delims=" %%D in (\`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"\`) do set "DESKTOP=%%D"
if not defined DESKTOP set "DESKTOP=%USERPROFILE%\\Desktop"
set "STARTMENU=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs"
(
  echo [InternetShortcut]
  echo URL=%APPURL%
) > "%DESKTOP%\\%APPNAME%.url"
(
  echo [InternetShortcut]
  echo URL=%APPURL%
) > "%STARTMENU%\\%APPNAME%.url"
echo.
echo   %APPNAME% is installed.
echo   Shortcuts were added to your desktop and Start menu.
echo.
echo   Opening it now. Tip: in Chrome or Edge, choose "Install app" in the
echo   address bar to give it its own window.
echo.
start "" "%APPURL%"
pause
`);
}

function windowsUninstall(name) {
  return crlf(`@echo off
set "APPNAME=${name}"
for /f "usebackq delims=" %%D in (\`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"\`) do set "DESKTOP=%%D"
if not defined DESKTOP set "DESKTOP=%USERPROFILE%\\Desktop"
del "%DESKTOP%\\%APPNAME%.url" 2>nul
del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\%APPNAME%.url" 2>nul
echo %APPNAME% shortcuts removed.
pause
`);
}

function macCommand(name, url) {
  return `#!/bin/bash
APPURL="${url}"
APPNAME="${name}"
cat > "$HOME/Desktop/$APPNAME.webloc" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>$APPURL</string></dict></plist>
EOF
echo ""
echo "  $APPNAME is installed. A shortcut was added to your Desktop."
echo "  Opening it now. Tip: in Chrome or Edge, choose \\"Install app\\" in the address bar."
echo ""
open "$APPURL"
`;
}

function linuxSh(name, url, slug) {
  return `#!/bin/sh
APPURL="${url}"
APPNAME="${name}"
DIR="$HOME/.local/share/applications"
mkdir -p "$DIR"
FILE="$DIR/${slug}.desktop"
cat > "$FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APPNAME
Comment=Daily standup updates
Exec=xdg-open $APPURL
Icon=user-available
Terminal=false
Categories=Office;
EOF
chmod +x "$FILE"
if [ -d "$HOME/Desktop" ]; then
  cp "$FILE" "$HOME/Desktop/" && chmod +x "$HOME/Desktop/${slug}.desktop"
  command -v gio >/dev/null 2>&1 && gio set "$HOME/Desktop/${slug}.desktop" metadata::trusted true 2>/dev/null
fi
echo ""
echo "  $APPNAME is installed (application menu and Desktop)."
echo ""
xdg-open "$APPURL" >/dev/null 2>&1 &
`;
}

function readme(kind, name, url) {
  return `${name} - ${kind} installation
${'='.repeat(name.length + kind.length + 16)}

Your company's ${APP_NAME} server is at:

    ${url}

Pick the installer for your computer and run it:

  Windows   Double-click "Install-${kind}-Windows.bat"
            (remove it later with "Uninstall-${kind}-Windows.bat")
  macOS     Double-click "Install-${kind}-Mac.command"
            (if macOS blocks it: right-click > Open, then Open again)
  Linux     Run:  sh Install-${kind}-Linux.sh

Each installer adds a "${name}" shortcut and opens the app in your browser.

Prefer no installer? Open the address above in Chrome or Edge and choose
"Install app" from the address bar (or the browser menu). On phones, use
"Add to Home Screen".

First time? Check your email for the invitation link from ${APP_NAME},
or use "Forgot password" on the sign-in screen.

See README-${kind === 'Worker' ? 'WORKER' : 'ADMIN'}.md in this folder for the full guide.
`;
}

// ---- Windows desktop app (built with desktop\build.cmd into installers\desktop\app)
function desktopInstallBat() {
  return crlf(`@echo off
setlocal
title Install ${APP_NAME}
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\\Programs\\MikesEZStandup"
if not exist "%SRC%app\\MikesEZStandup.exe" goto noapp

rem Close a running copy so its files can be replaced
taskkill /im MikesEZStandup.exe /f >nul 2>nul
if not exist "%DEST%" mkdir "%DEST%"
xcopy "%SRC%app\\*" "%DEST%\\" /e /i /q /y >nul
if exist "%SRC%MikesEZStandup.json" copy /y "%SRC%MikesEZStandup.json" "%DEST%\\" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) { $l = $sh.CreateShortcut((Join-Path $dir 'Mike''s EZ Standup.lnk')); $l.TargetPath = '%DEST%\\MikesEZStandup.exe'; $l.WorkingDirectory = '%DEST%'; $l.Save() }"

set "WV=0"
reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "WV=1"
reg query "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "WV=1"

echo.
echo   ${APP_NAME} is installed.
echo   Shortcuts were added to your desktop and Start menu. It also starts with Windows
echo   and waits in the system tray to remind you about standups.
if "%WV%"=="0" echo   Note: the Microsoft WebView2 Runtime may be missing. If so, the app will offer to download it.
echo.
start "" "%DEST%\\MikesEZStandup.exe"
pause
exit /b 0

:noapp
echo.
echo   The program files were not found next to this installer.
echo   If you downloaded the zip, extract all files first, then run this again.
echo   Administrators: build the app with desktop\\build.cmd on the server.
echo.
pause
exit /b 1
`);
}

function desktopUninstallBat() {
  return crlf(`@echo off
title Uninstall ${APP_NAME}
taskkill /im MikesEZStandup.exe /f >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; (Get-Item $k).Property | Where-Object { $_ -like 'MikesEZStandup*' } | ForEach-Object { Remove-ItemProperty -Path $k -Name $_ }; foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) { Remove-Item -ErrorAction SilentlyContinue (Join-Path $dir 'Mike''s EZ Standup*.lnk') }"
rmdir /s /q "%LOCALAPPDATA%\\Programs\\MikesEZStandup" 2>nul
echo.
echo   ${APP_NAME} desktop app removed.
echo   Your sign-ins and settings are kept in %LOCALAPPDATA%\\MikesEZStandup (delete that folder to remove them too).
echo.
pause
`);
}

function desktopReadme(url) {
  return `${APP_NAME} - Windows desktop app
${'='.repeat(APP_NAME.length + 22)}

Server: ${url}

Install
  From a network share:  double-click Install-Desktop-Windows.bat
  From the download:     extract MikesEZStandup-Desktop.zip (right-click > Extract All),
                         then double-click Install-Desktop-Windows.bat

The first time it runs, Windows may say "Windows protected your PC".
Choose "More info", then "Run anyway".

The app has its own window, waits in the system tray, starts with Windows, and shows a
notification when a standup update or meeting is due. Right-click the tray icon for options,
including "Accounts > Open another account..." to sign in as a second person side by side.

Remove it with Uninstall-Desktop-Windows.bat.
`;
}

function writeDesktopFiles(publicUrl) {
  // Only the generated files are replaced; the built program in app\\ is left alone.
  const dir = path.join(paths.INSTALLERS, 'desktop');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MikesEZStandup.json'), JSON.stringify({ serverUrl: publicUrl }, null, 2));
  fs.writeFileSync(path.join(dir, 'Install-Desktop-Windows.bat'), desktopInstallBat());
  fs.writeFileSync(path.join(dir, 'Uninstall-Desktop-Windows.bat'), desktopUninstallBat());
  fs.writeFileSync(path.join(dir, 'README.txt'), desktopReadme(publicUrl));
}

// ---- "Trust certificate" helpers, only when the server uses its own (self-signed) certificate.
// The Windows file has the certificate built in, so it works as a single download.
function trustBat(pem, host) {
  const lines = pem.trim().split(/\r?\n/).filter((l) => /^[-A-Za-z0-9+/= ]+$/.test(l));
  const echo = lines.map((l, i) => `${i === 0 ? '>' : '>>'}"%CRT%" echo ${l}`).join('\n');
  return crlf(`@echo off
setlocal
title Trust the ${APP_NAME} server
echo.
echo   This tells Windows to trust the ${APP_NAME} server at ${host},
echo   so your browser stops showing "Not secure" for it.
echo.
echo   Windows will show a security warning next. Choose Yes to continue.
echo.
pause
set "CRT=%TEMP%\\MikesEZStandup-Certificate.crt"
${echo}
certutil -user -addstore Root "%CRT%" >nul
if errorlevel 1 goto failed
del "%CRT%" >nul 2>nul
echo.
echo   Done. Close ALL browser windows, then open ${APP_NAME} again.
echo   (Firefox keeps its own list: see the README.txt next to this file on the downloads page.)
echo.
pause
exit /b 0
:failed
del "%CRT%" >nul 2>nul
echo.
echo   The certificate was not installed (the security warning may have been declined).
echo   Run this file again and choose Yes.
echo.
pause
exit /b 1
`);
}

function trustMac(pem) {
  return `#!/bin/bash
# Trust the ${APP_NAME} server certificate for this Mac user (asks for your password).
CRT="$(mktemp -t mikes-ez-standup).crt"
cat > "$CRT" <<'CERTEND'
${pem.trim()}
CERTEND
security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$CRT" && echo "Done. Quit and reopen your browser."
rm -f "$CRT"
`;
}

function trustReadme(host) {
  return `Trusting the ${APP_NAME} server certificate
${'='.repeat(APP_NAME.length + 34)}

The server (${host}) uses its own certificate. Browsers show "Not secure" until each
computer trusts it. You only need this if you use the app in a browser; the desktop app
doesn't need it.

  Windows   Double-click Trust-Certificate-Windows.bat and choose Yes at the security
            warning. Then close all browser windows and open the app again.
            (Works for Chrome and Edge. No administrator rights needed.)
  macOS     Double-click Trust-Certificate-Mac.command and enter your password.
            (If macOS blocks it: right-click > Open, then Open.)
  Firefox   Settings > Privacy & Security > View Certificates > Authorities > Import,
            choose MikesEZStandup-Certificate.crt, tick "Trust this CA to identify websites".

If the server's certificate is ever replaced, do this again with the new files.
`;
}

function writeCertificateFiles() {
  const { loadConfig } = require('../server/config');
  const cfg = loadConfig() || {};
  const dir = path.join(paths.INSTALLERS, 'certificate');
  fs.rmSync(dir, { recursive: true, force: true });
  const h = cfg.https || {};
  if (!h.enabled || h.selfSigned === false || !h.certFile) return; // a company certificate is trusted already
  let pem;
  try { pem = fs.readFileSync(path.resolve(paths.ROOT, h.certFile), 'utf8'); } catch (_) { return; }
  const first = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/) || [])[0];
  if (!first) return;
  const host = cfg.publicUrl || 'your server';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Trust-Certificate-Windows.bat'), trustBat(first, host));
  fs.writeFileSync(path.join(dir, 'Trust-Certificate-Mac.command'), trustMac(first), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'MikesEZStandup-Certificate.crt'), first + '\n');
  fs.writeFileSync(path.join(dir, 'README.txt'), trustReadme(host));
}

function writeClientInstallers(publicUrl) {
  writeDesktopFiles(publicUrl);
  writeCertificateFiles();
  const kinds = [
    { kind: 'Worker', dir: 'worker', name: APP_NAME, url: `${publicUrl}/worker`, slug: 'mikes-ez-standup', doc: 'README-WORKER.md' },
    { kind: 'Admin', dir: 'admin', name: `${APP_NAME} Admin`, url: `${publicUrl}/admin`, slug: 'mikes-ez-standup-admin', doc: 'README-ADMIN.md' },
  ];
  for (const k of kinds) {
    const dir = path.join(paths.INSTALLERS, k.dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `Install-${k.kind}-Windows.bat`), windowsBat(k.name, k.url));
    fs.writeFileSync(path.join(dir, `Uninstall-${k.kind}-Windows.bat`), windowsUninstall(k.name));
    fs.writeFileSync(path.join(dir, `Install-${k.kind}-Mac.command`), macCommand(k.name, k.url), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, `Install-${k.kind}-Linux.sh`), linuxSh(k.name, k.url, k.slug), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'README.txt'), readme(k.kind, k.name, k.url));
    const doc = path.join(paths.ROOT, k.doc);
    if (fs.existsSync(doc)) fs.copyFileSync(doc, path.join(dir, k.doc));
  }
}

module.exports = { writeClientInstallers };

if (require.main === module) {
  const { loadConfig } = require('../server/config');
  const cfg = loadConfig();
  if (!cfg) { console.error('Install the server first: node install/install-server.js'); process.exit(1); }
  writeClientInstallers(cfg.publicUrl);
  console.log(`Client installers regenerated for ${cfg.publicUrl}`);
}
