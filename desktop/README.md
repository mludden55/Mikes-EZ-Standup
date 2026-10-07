# Mike's EZ Standup - Windows desktop app

A small Windows program (about 2 MB) that shows Mike's EZ Standup in its own window, sits in
the system tray, and pops up Windows notifications when a standup update or meeting is due.
It uses the same screens as the browser version, so every feature works in both.

## Building it (once, on any Windows 10/11 PC)

1. Install the free **.NET SDK** (version 8 or newer) from https://dotnet.microsoft.com/download.
   (Only needed for building. People who use the app don't need it.)
2. Install the server first (see the main README.md), so the installer knows the server address.
3. Double-click **`desktop\build.cmd`**.

The result goes to `installers\desktop\`:

| File | Purpose |
| --- | --- |
| `app\MikesEZStandup.exe` (+ a few DLLs) | the program |
| `MikesEZStandup-Desktop.zip` | everything in one download, offered on the server's `/downloads` page |
| `Install-Desktop-Windows.bat` | installs it for the current user, from a network share or the unzipped download |
| `MikesEZStandup.json` | the server address, so the app connects on first run without asking |

Run `build.cmd` again after changing the server address (or the app will ask for the new one).

Prefer Visual Studio? Open `MikesEZStandup.csproj` in Visual Studio 2022 (free Community edition)
and build in Release mode.

## Requirements for people using it

- Windows 10 or 11. Uses .NET Framework 4.8 and the Microsoft Edge WebView2 Runtime, both
  already part of Windows 11 and current Windows 10. If WebView2 is missing, the app offers
  Microsoft's download page.
- No administrator rights: it installs to `%LOCALAPPDATA%\Programs\MikesEZStandup`.

## What it does

- **Own window** with the standup screens (workers land in the Worker portal, admins in the Admin portal).
- **Tray icon**: closing the window keeps it running in the tray. Right-click for the menu,
  double-click to open. It starts with Windows (change in the tray menu).
- **Notifications** when a scheduled update or request arrives, when a standup meeting is
  about to start (click to join), and when a message or shared update arrives. It checks every minute.
- **Voice without HTTPS**: the app allows the microphone for your server's address even over
  plain `http://`, and accepts your server's self-signed certificate. No browser warnings.
- **Meeting and other outside links** open in the default browser (Teams links open Teams).
- **Remembers passwords**: like Edge, it offers to save your password when you sign in and
  fills it in next time. Saved passwords stay on this PC, separately for each profile.
  With **Keep me signed in** ticked, you stay signed in for 90 days anyway.

## Several accounts on one PC (handy for testing)

Each **profile** has its own sign-in, window, tray icon and notifications:

- Tray menu > **Accounts** > **Open another account...**, enter a name such as `Test Worker`, and sign
  in as a different person in the new window. Both run side by side.
- Or start it from a shortcut or command line: `MikesEZStandup.exe --profile "Test Worker"`

Profiles are stored in `%LOCALAPPDATA%\MikesEZStandup\Profiles\`. Deleting a profile's folder
signs it out and forgets its settings.

## Known limitations

- **Unsigned program:** the first time it runs, Windows SmartScreen may say "Windows protected
  your PC". Choose **More info** > **Run anyway**. A code-signing certificate removes this.
- Notifications only appear while the app is running (it starts with Windows by default).
- Windows only. Mac and Linux users keep using the browser.
- Meeting reminders use the PC's clock and assume the PC and server are in the same time zone.
