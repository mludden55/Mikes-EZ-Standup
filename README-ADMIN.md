# Mike's EZ Standup: Administrator Guide

As an administrator you read and listen to your teams' standup updates, ask for updates,
share project news, choose the days standup requests go out, and manage teams and other
administrators.

> **Important:** there must always be at least one **Primary Administrator**. The app won't
> let you remove the last one. If your company ends up with no Primary Administrators, the
> app must be **reinstalled** on the server to create a new one (see README.md, "Reinstalling").

## Kinds of administrators

Every administrator, Primary or not, works with **the teams assigned to them** (Reports,
Request Update, Send Update, Configure Updates, Edit Teams). Being a **Primary Administrator**
adds the job of managing the administrators themselves.

| | Administrator | Primary Administrator |
| --- | --- | --- |
| Works with | The teams assigned to them | The teams assigned to them |
| Creates teams | Yes (they become its administrator) | Yes (they become its administrator) |
| Adds administrators / edits their teams | Only for teams they administer | For any team, including their own |
| Makes someone a Primary Administrator | No | Yes |
| Removes administrators | No | Yes |

A Primary Administrator can give themselves any team at any time (Administrator Portal >
**Edit** on their own row), so they never lose access to a team.

The first Primary Administrator is created when the server is installed.

Administrators can also be workers: if you're a member of a team, use **Worker Portal** at
the top of the screen to send your own updates.

## Installing

### The server (done once, by IT or the first administrator)

See [README.md](README.md) for full details. In short:

1. Install Node.js 20 or newer on the server computer.
2. In the app folder run `node install/install-server.js`. It asks for the
   **Primary Administrator email address** and **password** (both required), the server
   address, HTTPS and email settings.
3. Run `npm install` (for email) and `npm start`.

### Your computer (Admin installation)

Run the installer from `installers/admin/` (or download it from `https://<server>/downloads`):

- Windows: `Install-Admin-Windows.bat`
- macOS: `Install-Admin-Mac.command`
- Linux: `sh Install-Admin-Linux.sh`

Or open `https://<server>/admin` in Chrome or Edge and choose **Install app**.

### Windows desktop app

Workers and admins on Windows can use the desktop app instead of a browser: its own window,
a tray icon, and notifications when updates or meetings are due. Build it once with
`desktop\build.cmd` (see desktop/README.md), then share `installers\desktop` on a network drive
or let people download the zip from `/downloads`.

### Testing as an admin and a worker on one PC

In the desktop app, right-click the tray icon > **Accounts** > **Open another account...**, name
it (for example "Test Worker"), and sign in as a worker in the new window. Both windows run
side by side with separate sign-ins and notifications. (In a browser, use a normal window for
one account and a private/incognito window for the other.)

To create test workers without extra mailboxes, use Gmail's plus addressing, for example
`you+worker1@gmail.com`: it's a separate account in the app, but the invitation arrives in
your normal inbox.

## Signing in

The login screen is the same as the Worker Portal: **email**, **password**, and
**Forgot password?** (sends a reset link to your email). Administrators go straight to the
Admin Portal after signing in.

## The Admin Portal home screen

Six options:

1. **Reports**
2. **Request Update**
3. **Send Update**
4. **Configure Updates**
5. **Edit Teams**
6. **Administrator Portal**

**Team selector:** if you administer more than one team, screens that work per team show a
**Team** selector at the top with an **All teams** option.

---

## 1. Reports

Opens on **Today**: all of today's reports, newest first.

Each report shows the person, the time, their teams, and either the text, a voice player,
"Rejected request" or "Can't attend meeting" with the reasons they gave. "Answering" shows
what it replied to. "Shared with" shows who else has received it.

On update days, a yellow box lists **who hasn't reported yet** (and the deadline, if one is
set). Updates sent after the deadline show a red **Late** tag. On meeting days, a blue box
shows the meeting time and link, who **clicked Join**, who **can't attend**, who **sent a
written update instead**, and who hasn't responded. ("Clicked Join" means they opened the
meeting from the app; the app can't see who stayed in the call.)

- **Search by date:** a calendar opens; days with updates have a dot. Click a date to see
  every report for that day (for the selected team, or all teams).
- **Search by individual:** a list of names sorted by last name, then first name. Click a
  name to see their **last 7 days**. Choose **Search by date** to pick any day for that person.

**Forwarding an update:** choose **Forward** on any update, tick the people who should see
it (for example, someone working on the same project), add an optional note, and choose
**Forward**. They get it in their **Messages** tab.

## 2. Request Update

Ask workers for an update.

1. Choose the **Team** (if you have more than one; **All teams** is available).
2. The box starts with "Please send a quick update for today." You can send it as it is,
   or click in the box and add to it; the starting text stays.
3. **Deadline (optional):** pick a date and time. The time starts at 12:00 PM, and after that
   at the last time you chose on this computer. Workers see "Due by ..." on the request, it
   turns red as **Overdue** once the time passes, and the desktop app reminds them an hour before.
4. Leave **Send to All** ticked, or untick it and pick specific workers.
5. Choose **Send**.

Workers see the request in **Pending Requests**. Each worker chooses whether to answer by
**text, voice or video**, or rejects it with a reason. **Recently sent** shows how many people
have answered each request.

## 3. Send Update

Shares project news from you to workers (for example "Code freeze moved to Wednesday").

1. Choose the **Team**.
2. **Message type:** tick **Text**, plus **Voice** or **Video**. Text is ticked by default.
   Voice and video are either/or: ticking one unticks the other.
3. The text box starts with "Project update for <today's date>: ". Type after it.
   Record voice or video with the round button (Record, Replay, Delete).
4. Choose who to send to, then **Send**.

Workers see it in their **Messages** tab. **Recently sent** shows how many people have read
each one.

## 4. Configure Updates

Choose what happens on each day of the week.

1. Choose the **Team**. Each team has its own schedule.
2. **Standup days:** for each day from Monday to Sunday, choose:
   - **Off:** nothing happens.
   - **Send update:** workers get a pending request and reply with a text, voice or video update.
   - **Meeting:** the team meets live. Workers get a **Join meeting** button instead.
3. **Deadlines (optional):** each day set to **Send update** shows **Due by** with hour /
   minute / AM-PM lists in its row, so every day can have its own deadline (for example
   10:00 AM on Tuesday and 3:00 PM on Thursday). Leave it empty, or use **Clear**, for no
   deadline that day. **Apply to all** copies that row's deadline to every Send update day.
   Workers see "Due by ..." on the request, it turns red as **Overdue** after that, updates
   sent later are tagged **Late** in Reports, and the desktop app reminds people an hour before.
   If someone is on several teams with deadlines on the same day, the earliest applies.
4. **Meeting details** (shown once any day is set to Meeting):
   - **Start time** and **End time**, chosen with hour / minute / AM-PM lists (in the server's
     time zone). **Clear** empties a time.
   - **Meeting link**: a Microsoft Teams, Zoom, Google Meet, Webex or other link. Use
     **Test the link** to check it opens.
   - **Notes**, e.g. "Conference room B". For an in-person standup, leave the link empty and
     put the room in the notes; workers then get an **I'm attending** button.
5. **When this schedule is active:**
   - **Always:** no start or stop date.
   - **Between dates:** set a start and/or stop date.
6. **Excluded dates:** click dates on the calendar (holidays, team offsites) to skip them.
   No request and no meeting happen on excluded dates. Click again to include them.
7. **Save schedule.**

New teams start with Monday to Friday set to **Send update**.

### Getting a meeting link

The app doesn't create the meeting; you create a **recurring** meeting once, invite the team,
and paste its join link into **Meeting link**. One link works for every occurrence. The
**How do I get a meeting link?** section on the page has short steps for Microsoft Teams,
Zoom, Google Meet and Webex. For Teams: in Outlook or the Teams calendar, create a meeting that
repeats on your standup days with **Teams meeting** turned on, then open it, right-click
**Join the meeting now**, and choose **Copy link**.

The meeting invitation in people's calendars stays the main reminder; the app adds a Join
button where they already send updates and tracks who joined or can't attend.

## 5. Edit Teams

- **Add Team:** enter a **Team name** and **Description**, then **Create team**. You become
  an administrator of teams you create.
- **Edit a team:** choose it from the list to:
  - change its name or description (**Save changes**)
  - see its members in a scrolling list
  - **Edit**: change the person's first and last name, and their optional role on this team,
    such as "QA" or "Scrum master".
    Roles show next to names in Reports, the people list, and workers' "Sending to" lists.
    A person can have a different role on each team.
  - **Add team member**, either:
    - **Someone already in the app** (for example, a person on another team): search by name
      or email, tick one or more people, and choose **Add selected**. No email is sent.
    - **Someone new:** email, first name and last name. Leave **Send email** ticked to email
      them an invitation to create their password, or untick it and use **Resend invite**
      later. If email isn't set up, you get a link to send them yourself.
  - **Delete** a team member (they keep their account and history)
  - **Resend invite** to someone who hasn't created a password yet
  - **Delete team** (members keep their accounts; past updates stay in Reports)

## 6. Administrator Portal

- **Add Administrator:** enter their **email** (plus first and last name if they're new to
  the app) and tick the **teams** they will administer. They get an email letting them know.
- **Edit:** change which teams an administrator manages, with the same team checkboxes.
  - A **Primary Administrator** can edit anyone, including themselves and other Primary
    Administrators, and can assign any team.
  - Other administrators can edit non-primary administrators, and only add or remove teams
    they administer themselves; the person's other teams stay as they are.
- **Teams with no administrator** are listed in a yellow box for Primary Administrators.
  Use **Edit** on someone (or yourself) to assign them.

Only a **Primary Administrator** can:

- **Make Primary:** give another administrator Primary Administrator rights.
- **Remove Primary:** take Primary rights away (not from the last one).
- **Remove administrator:** they keep their worker account. The last Primary Administrator
  can't be removed.
- **Send me a test email:** check that email delivery works.
- **Storage & cleanup:** choose how long old items are kept. Both settings offer 30, 60, 90
  or 180 days, 1 year, or forever, and both start at **60 days**. The app deletes older items
  automatically every hour; **Clean up now** does it immediately and shows what was removed.
  - **Messages and requests:** project updates, shared or forwarded updates, and update
    requests. Requests with a deadline are kept until at least 14 days after it.
  - **Standup updates and their recordings:** your Reports history. Pick a longer period
    (or Forever) if you want to look back further than 60 days.
  - A recording is deleted only when nothing that's kept still uses it. The panel also shows
    how much space the database, voice recordings and videos use. Videos take by far the most.

---

## Where things are stored on the server

| Folder | Contents |
| --- | --- |
| `installers/worker`, `installers/admin` | Worker and Admin installation files |
| `data/db.json` | All teams, people, schedules, requests and updates |
| `data/recordings/` | Voice recordings, by year and month |
| `data/text-updates/` | A text file for every text update, by date |
| `data/outbox/` | Emails that couldn't be sent (no SMTP set up) |
| `data/backups/` | Daily database snapshots (30 days) |
| `logs/` | Daily activity and error logs (90 days) |
| `config/config.json` | Server settings, including email (SMTP) and the donation link |

## Troubleshooting

- **Workers can't record voice:** the server needs HTTPS. Run `node install/enable-https.js`
  on the server (see README.md, "Turning on HTTPS").
- **Nobody gets emails:** set up SMTP in `config/config.json` (see README.md, "Email setup"), restart,
  run `node install/test-email.js you@example.com` on the server to diagnose, and
  use **Send me a test email**. Until then, emails are saved in `data/outbox/`.
- **Browser says the connection isn't private:** the server uses a self-signed certificate.
  Install `config/certs/cert.pem` as trusted on each computer, or use a company certificate.
- **Wrong day for requests:** schedules use the server's time zone and clock.
- **Locked out with no Primary Administrator:** reinstall on the server
  (`node install/install-server.js`) and choose "keep existing data" to set a new one.
