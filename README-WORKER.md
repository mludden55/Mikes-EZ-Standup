# Mike's EZ Standup: Worker Guide

Mike's EZ Standup is where you share your daily standup update with your team, by voice or
by text, whenever it suits you. Your administrators read and listen to the updates.

## Installing

Your administrator will give you a "Worker" installer, or a link to
`https://<your-server>/downloads`.

- **Windows desktop app (recommended on Windows 10/11):** download
  `MikesEZStandup-Desktop.zip` from `https://<your-server>/downloads` (or get it from your
  administrator), right-click it > **Extract All**, then double-click
  `Install-Desktop-Windows.bat`. If Windows says "Windows protected your PC", choose
  **More info** > **Run anyway**. See "The desktop app" below.
- **Windows (browser shortcut):** double-click `Install-Worker-Windows.bat`. A "Mike's EZ Standup" shortcut
  appears on your desktop and in the Start menu.
- **macOS:** double-click `Install-Worker-Mac.command`. If macOS blocks it, right-click it,
  choose Open, then Open again.
- **Linux:** run `sh Install-Worker-Linux.sh`.
- **No installer:** open the Worker Portal address in Chrome or Edge and choose
  **Install app** in the address bar. On a phone, use **Add to Home Screen**.

If your browser warns that the connection isn't private the first time, your company is using
its own certificate. Check with your administrator, then continue to the site.

## The desktop app

- It opens in its own window. Closing the window keeps it running in the **system tray**
  (near the clock) so it can remind you. Double-click the tray icon to open it again.
- It starts with Windows and shows a **notification** when a standup update is due, when an
  admin asks you for an update, when a standup meeting is about to start (click the
  notification to join), and when you get a message.
- Right-click the tray icon for: **Notifications** on/off, **Start with Windows** on/off,
  **Change server address**, **Accounts**, and **Exit**.
- **Accounts > Open another account...** opens a second window with its own sign-in.
- Remove it with `Uninstall-Desktop-Windows.bat`.

## Signing in

1. Open Mike's EZ Standup.
2. Enter your **email** (this is your login) and **password**.
3. Choose **Sign in**.

**Keep me signed in** (ticked by default) keeps you signed in on this computer for 90 days.
Untick it on a shared computer; you'll then be signed out when the browser or app closes.

**First time?** When you are added to a team you receive an email invitation. Open the link
in it to create your password. The link works for 7 days.

**Choosing a password:** wherever you set a password, **Suggest a strong password** fills in a
random one (for example `7caF-KN7t-xA3c-fTnR`) and shows it so you can copy it. The meter
under the box rates any password you type. In the desktop app, choose **Save** when it offers
to remember your password; it fills it in next time.

**Forgot your password?** Choose **Forgot password?** on the sign-in screen and enter your
email. You'll get an email with a link to choose a new password. The link works once and
expires after 1 hour.

You can change your password any time with **Change password** at the top of the screen.

## The main screen

There are four tabs:

| Tab | What it's for |
| --- | --- |
| **Send Updates** | Send your update by voice or text |
| **Pending Requests** | Standups, questions and meetings waiting for you (the yellow number shows how many) |
| **Messages** | Project updates from your administrators, and updates shared with you |
| **My Updates** | What you've sent in the last 14 days, with a Forward button |

## Sending an update

You can send an update by **text**, **voice** or **video**. A good update covers three things: what you did since the last update, what you're doing next,
and anything blocking you.

### By voice

1. On **Send Updates**, choose **Voice**. The Voice Update screen opens.
2. **Record**: tap the big round button (or **Record**). Allow microphone access if your
   browser asks. Talk, then tap again to stop. Recordings can be up to 3 minutes.
3. **Replay**: listen to what you recorded.
4. **Delete**: throw it away and start over. (Choosing Record again also replaces it.)
5. **Send**: sends the recording.

If you see "Voice recording needs a secure (https://) connection", your server isn't set up
for voice yet. Send a text update and let your administrator know.

### By video

Handy for showing a demo or something on your screen. Video files are much larger than
voice or text, so use video only when you need to show something.

1. On **Send Updates**, choose **Video**. The Video Update screen opens and your camera turns
   on straight away, so you can check it works (allow camera and microphone access if asked).
2. **Record**: tap the round camera button to start. Tap again to stop (up to 3 minutes).
   If there's a problem, the screen says what's wrong, such as **No camera found**,
   **Camera access is blocked**, or **The camera is busy** (another app such as Teams is using
   it), with a **Try again** button. You can always go back and send a text or voice update.
3. **Replay** plays it back, **Delete** throws it away, and **Send** sends it.

### By text

1. On **Send Updates**, choose **Text**. The Text Update screen opens.
2. **Create**: opens a box that already contains the standup template:
   ```
   Yesterday:
   Today:
   Blockers:
   ```
   The cursor starts after "Yesterday:". Type there, then click after "Today:" and
   "Blockers:" and type your answers. You can add extra lines anywhere.
3. **Review**: shows your update exactly as it will be sent. Choose **Edit** to change it.
4. **Delete**: clears what you typed.
5. **Send**: sends the text. (Send stays greyed out until you've written something
   besides the labels.)

When you send an update, it automatically answers your pending requests. It doesn't
answer a standup meeting, so you can still join the meeting afterward.

### Who sees your update

Below the recorder or text box, **Sending to** shows:

- **Admins**: always ticked. Your admins see every update in their reports.
- Your **team members** (with their role, if one is set): tick anyone who should also get this update. They'll find it in
  their **Messages** tab. (A long list scrolls.)

## Pending Requests

A request appears here when:

- **It's a scheduled update day.** Your administrator picks the days (for example Monday,
  Wednesday and Friday). On those days a request is listed with the day and date, and
  **Due by** a time if your administrator set a deadline (red **Overdue** once it passes).
- **An administrator asks you directly.** Their message is shown with the request. If they set
  a deadline, the request shows **Due by** with the date and time (yellow when less than an
  hour is left, red **Overdue** after it passes). The desktop app also reminds you an hour
  before. Requests stay listed until you answer them, or 14 days after the deadline.

For each request you can:

- **Send Updates**: takes you to the Send Updates tab. A yellow banner shows which request
  you're answering.
- **Reject**: when you can't or don't need to send an update. Tick one or more reasons:
  - Sick
  - Out of office
  - On vacation / PTO
  - Nothing to share
  - Busy
  - In meetings all day
  - Blocked - would like to talk live
  - Already shared in a meeting or chat
  - Personal / family matter
  - Other (type your reason)

  Then choose **Submit**. Your administrator sees the reasons in their reports.

## Standup meetings

Some teams meet live on some days instead of sending updates. Meetings are not requests, so
they don't appear under **Pending Requests**. On a meeting day:

- **Send Updates** shows a blue meeting card at the top with the start and end time and a
  **Join meeting** button.
- **Join meeting** opens the meeting (Microsoft Teams, Zoom, Google Meet, etc.) in a new
  tab and lets your admin know you joined. If you get disconnected, use **Join again**.
  For in-person standups the button says **I'm attending**.
- **Can't attend**: tick a reason (same list as above) so your admin knows.
- **Send an update instead**: opens Send Updates so you can type or record your update rather
  than attending.

## Messages

This tab shows, newest first:

- project updates from your administrators (text and/or voice)
- updates a teammate shared with you
- updates an administrator forwarded to you (with their note, if they added one)

Unread messages have a yellow edge and are counted on the tab.

## My Updates

Everything you've sent in the last 14 days. To share one of your updates later, choose
**Forward** next to it, tick the teammates, add an optional note, and choose **Forward**.
"Shared with" under an update shows who it was shared with.

## Privacy

Your updates and recordings are stored on your company's own server, not in the cloud. The
administrators of your teams can read and listen to them.

## Need help?

Contact your team's administrator.

---

**Note:** your company's Mike's EZ Standup must always have at least one Primary Administrator.
If none remain, the app has to be reinstalled on the server; your administrators will let you
know if that affects you.
