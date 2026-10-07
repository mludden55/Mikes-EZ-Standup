using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Security;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MikesEZStandup
{
    public class MainForm : Form
    {
        const string AppName = "Mike's EZ Standup";
        const string SessionCookie = "mas_session";
        static readonly Color Slate = Color.FromArgb(233, 237, 241);

        readonly Options opts;
        readonly ProfileSettings settings;
        readonly WebView2 web;
        readonly NotifyIcon tray;
        readonly ContextMenuStrip trayMenu;
        readonly System.Windows.Forms.Timer pollTimer;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        HttpClient http;
        Uri server;
        bool allowShow;
        bool reallyExit;
        bool webReady;
        bool polling;
        DateTime lastPagePoll = DateTime.MinValue;

        // Notification memory (per run)
        bool firstPoll = true;
        readonly HashSet<string> seenKeys = new HashSet<string>();
        readonly HashSet<string> remindedMeetings = new HashSet<string>();
        readonly HashSet<string> remindedDeadlines = new HashSet<string>();
        int lastUnread = -1;
        Action balloonAction;

        public MainForm(Options opts, EventWaitHandle showSignal)
        {
            this.opts = opts;
            settings = ProfileSettings.Load(opts.Profile);
            allowShow = !opts.Background;

            Text = Profiles.IsDefault(opts.Profile) ? AppName : AppName + " - " + opts.Profile;
            Icon = LoadIcon(32);
            BackColor = Slate;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            MinimumSize = new Size(420, 500);
            Size = new Size(Math.Max(settings.Width, 600), Math.Max(settings.Height, 500));

            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Slate };
            Controls.Add(web);

            trayMenu = new ContextMenuStrip();
            trayMenu.Opening += (s, e) => BuildTrayMenu();
            tray = new NotifyIcon { Icon = LoadIcon(16), Text = Truncate(Text, 63), ContextMenuStrip = trayMenu, Visible = true };
            tray.DoubleClick += (s, e) => ShowFromTray();
            tray.BalloonTipClicked += (s, e) => { var a = balloonAction; balloonAction = null; if (a != null) a(); };

            pollTimer = new System.Windows.Forms.Timer { Interval = 60 * 1000 };
            pollTimer.Tick += async (s, e) => await PollAsync();

            FormClosing += OnFormClosing;

            // A second launch of the same profile asks this window to come forward.
            ThreadPool.RegisterWaitForSingleObject(showSignal, (state, timedOut) =>
            {
                try { BeginInvoke(new Action(ShowFromTray)); } catch { }
            }, null, Timeout.Infinite, false);

            // Create window handles now so the browser can start even when we launch hidden in the tray.
            if (!IsHandleCreated) CreateHandle();
            IntPtr h = web.Handle;
            BeginInvoke(new Action(async () => await StartAsync()));
        }

        /* ------------------------------------------------------------ start up */

        async Task StartAsync()
        {
            if (!ProfileSettings.IsValidServer(settings.ServerUrl, out server))
            {
                ShowFromTray();
                if (!AskForServer(true)) { ExitApp(); return; }
            }

            if (!settings.AskedAboutStartup)
            {
                settings.AskedAboutStartup = true;
                settings.StartWithWindows = Profiles.IsDefault(opts.Profile);
                Startup.Set(opts.Profile, settings.StartWithWindows);
                settings.Save();
            }

            var handler = new HttpClientHandler { UseCookies = false };
            // Accept the server's own certificate even if it is self-signed (only for that server).
            handler.ServerCertificateCustomValidationCallback = (msg, cert, chain, errors) =>
                errors == SslPolicyErrors.None || (msg.RequestUri != null && msg.RequestUri.Host == server.Host);
            http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };

            try
            {
                string dataFolder = Path.Combine(Profiles.Folder(opts.Profile), "WebView2");
                Directory.CreateDirectory(dataFolder);
                string args = "";
                // Browsers only allow the microphone on https:// pages. For a plain http:// server on
                // your own network, tell the built-in browser to treat that one address as secure.
                if (server.Scheme == Uri.UriSchemeHttp && !server.IsLoopback)
                    args = "--unsafely-treat-insecure-origin-as-secure=" + Origin(server);
                var env = await CoreWebView2Environment.CreateAsync(null, dataFolder, new CoreWebView2EnvironmentOptions(args));
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                ShowFromTray();
                if (MessageBox.Show(this,
                    "Mike's EZ Standup needs the Microsoft Edge WebView2 Runtime, which is built into Windows 11 and most Windows 10 PCs but is missing here.\n\nOpen the Microsoft download page now?",
                    AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                ExitApp();
                return;
            }
            catch (Exception ex)
            {
                ShowFromTray();
                MessageBox.Show(this, "The app could not start its browser component:\n\n" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitApp();
                return;
            }

            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            // Offer to save the password at sign-in and fill it in next time (like Edge).
            // Saved passwords are kept per profile, encrypted for this Windows user.
            core.Settings.IsPasswordAutosaveEnabled = true;
            core.Settings.IsGeneralAutofillEnabled = true;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.PermissionRequested += OnPermissionRequested;
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += OnNavigationStarting;
            core.NavigationCompleted += OnNavigationCompleted;
            core.WebMessageReceived += OnWebMessage;
            core.ServerCertificateErrorDetected += OnCertificateError;
            webReady = true;

            core.Navigate(new Uri(server, "/").ToString());
            pollTimer.Start();
        }

        /* ------------------------------------------------------ browser events */

        static string Origin(Uri u) { return u.GetLeftPart(UriPartial.Authority); }
        bool IsOurs(string url)
        {
            Uri u;
            return Uri.TryCreate(url, UriKind.Absolute, out u) && string.Equals(Origin(u), Origin(server), StringComparison.OrdinalIgnoreCase);
        }

        void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
        {
            // Microphone and camera (voice and video updates) and notifications are allowed for our server only.
            bool ours = IsOurs(e.Uri);
            if (ours && (e.PermissionKind == CoreWebView2PermissionKind.Microphone || e.PermissionKind == CoreWebView2PermissionKind.Camera
                         || e.PermissionKind == CoreWebView2PermissionKind.Notifications))
                e.State = CoreWebView2PermissionState.Allow;
            else
                e.State = CoreWebView2PermissionState.Deny;
        }

        void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // Links that open a new window (meeting links, donation page...) go to the default browser,
            // which hands Teams/Zoom links to their own apps.
            e.Handled = true;
            if (IsOurs(e.Uri)) web.CoreWebView2.Navigate(e.Uri);
            else OpenExternal(e.Uri);
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (e.Uri.StartsWith("about:") || e.Uri.StartsWith("data:") || IsOurs(e.Uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        }

        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            string html = "<!doctype html><html><head><meta charset='utf-8'><style>"
                + "body{font:16px 'Segoe UI',system-ui,sans-serif;background:#e9edf1;color:#18232e;display:grid;place-items:center;height:100vh;margin:0}"
                + ".box{background:#fff;border:1px solid #d3dae2;border-radius:10px;padding:28px;max-width:440px}"
                + "h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#5b6878}button{font:600 15px 'Segoe UI',sans-serif;padding:8px 16px;border-radius:6px;border:1px solid #d3dae2;background:#fff;cursor:pointer;margin-right:6px}"
                + "button.p{background:#0e6170;border-color:#0e6170;color:#fff}</style></head><body><div class='box'>"
                + "<h1>Can't reach the standup server</h1><p>" + WebUtility.HtmlEncode(Origin(server)) + " isn't responding (" + WebUtility.HtmlEncode(e.WebErrorStatus.ToString()) + ").</p>"
                + "<p>Check that the server is running and that you're on the company network, then try again.</p>"
                + "<button class='p' onclick=\"chrome.webview.postMessage('retry')\">Try again</button>"
                + "<button onclick=\"chrome.webview.postMessage('server')\">Change server address</button></div></body></html>";
            web.CoreWebView2.NavigateToString(html);
        }

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (e.Source.StartsWith("about:"))
            {
                if (msg == "retry") web.CoreWebView2.Navigate(new Uri(server, "/").ToString());
                else if (msg == "server") AskForServer(false);
            }
            else if (IsOurs(e.Source) && msg == "poll" && (DateTime.Now - lastPagePoll).TotalSeconds > 10)
            {
                // The page says something changed (signed in, sent an update...): refresh the tray now.
                lastPagePoll = DateTime.Now;
                var ignored = PollAsync();
            }
        }

        void OnCertificateError(object sender, CoreWebView2ServerCertificateErrorDetectedEventArgs e)
        {
            // Self-signed certificates are fine for our own server; anything else is refused.
            e.Action = IsOurs(e.RequestUri) ? CoreWebView2ServerCertificateErrorAction.AlwaysAllow : CoreWebView2ServerCertificateErrorAction.Cancel;
        }

        static void OpenExternal(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        /* ------------------------------------------------- tray notifications */

        async Task PollAsync()
        {
            if (!webReady || polling || http == null) return;
            polling = true;
            try
            {
                var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(Origin(server) + "/");
                var session = cookies.FirstOrDefault(c => c.Name == SessionCookie);
                if (session == null) { SetTrayStatus("Not signed in"); return; }

                var pending = await GetJson("/api/worker/pending", session.Value);
                var messages = await GetJson("/api/worker/messages", session.Value);
                if (pending == null || messages == null) { SetTrayStatus("Not signed in"); return; }

                var items = List(pending, "items");
                // Pending = update requests. Meetings are announced and reminded, but aren't "pending".
                var requests = items.Where(i => Str(i, "kind") != "meeting").ToList();
                var open = items.Where(i => Str(i, "kind") != "meeting" || Str(i, "status") == "open").ToList();
                int unread = Int(messages, "unread");
                SetTrayStatus(requests.Count == 0 ? "Nothing pending" : requests.Count + " pending");

                if (settings.Notifications) Notify(open, requests.Count, items, unread);
                foreach (var i in open) seenKeys.Add(Str(i, "key"));
                lastUnread = unread;
                firstPoll = false;
            }
            catch
            {
                SetTrayStatus("Can't reach the server");
            }
            finally { polling = false; }
        }

        void Notify(List<Dictionary<string, object>> open, int requestCount, List<Dictionary<string, object>> all, int unread)
        {
            // 1. Meeting about to start (5 minutes before, until 10 minutes after).
            foreach (var m in all.Where(i => Str(i, "kind") == "meeting" && Str(i, "status") == "open"))
            {
                string key = Str(m, "key");
                DateTime start;
                if (remindedMeetings.Contains(key) || !TryToday(Str(m, "time"), out start)) continue;
                double mins = (start - DateTime.Now).TotalMinutes;
                DateTime end;
                bool notOver = TryToday(Str(m, "endTime"), out end) ? DateTime.Now < end : mins >= -10;
                if (mins <= 5 && notOver)
                {
                    remindedMeetings.Add(key);
                    seenKeys.Add(key);
                    string link = Str(m, "link");
                    Balloon("Standup meeting " + (mins > 0 ? "at " + start.ToShortTimeString() : "has started"),
                        (string.IsNullOrEmpty(link) ? "Click to open the app." : "Click to join now.") + " (" + TeamsOf(m) + ")",
                        () => JoinMeeting(key, link));
                    return;
                }
            }

            // 2. A deadline (admin request or scheduled update day) is less than an hour away.
            foreach (var r in open.Where(i => Str(i, "kind") != "meeting" && Str(i, "deadline") != ""))
            {
                string key = Str(r, "key");
                DateTime due;
                if (remindedDeadlines.Contains(key) || !DateTime.TryParse(Str(r, "deadline"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out due)) continue;
                due = due.ToLocalTime();
                double mins = (due - DateTime.Now).TotalMinutes;
                if (mins <= 60 && mins > 0 && seenKeys.Contains(key))
                {
                    remindedDeadlines.Add(key);
                    string who = Str(r, "kind") == "request" ? "Requested by " + Str(r, "from") + "." : "Your standup update for " + TeamsOf(r) + ".";
                    Balloon("Update due at " + due.ToShortTimeString(), who + " Click to answer it now.", () => OpenPage("/worker#pending"));
                    return;
                }
            }

            // 3. New requests or meetings.
            var fresh = open.Where(i => !seenKeys.Contains(Str(i, "key"))).ToList();
            if (firstPoll && open.Count > 0)
            {
                var meeting = open.FirstOrDefault(i => Str(i, "kind") == "meeting");
                if (requestCount > 0)
                    Balloon(AppName, "You have " + requestCount + " pending request" + (requestCount > 1 ? "s" : "") + "."
                        + (meeting != null ? " There's also a standup meeting today" + (TimeText(meeting) ?? "") + "." : ""), () => OpenPage("/worker#pending"));
                else if (meeting != null)
                    Balloon("Standup meeting today" + (TimeText(meeting) ?? ""), "Click to open. (" + TeamsOf(meeting) + ")", () => OpenPage("/worker#send"));
                return;
            }
            if (fresh.Count == 1)
            {
                var i = fresh[0];
                string kind = Str(i, "kind");
                string title = kind == "meeting" ? "Standup meeting today" + (TimeText(i) ?? "")
                    : kind == "scheduled" ? "Time for your standup update"
                    : "Update requested by " + Str(i, "from");
                string text = kind == "request" && !string.IsNullOrEmpty(Str(i, "text")) ? Truncate(Str(i, "text"), 180) : "Click to open. (" + TeamsOf(i) + ")";
                DateTime dueAt;
                if (kind != "meeting" && DateTime.TryParse(Str(i, "deadline"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out dueAt))
                    text = "Due by " + dueAt.ToLocalTime().ToString("ddd h:mm tt") + ". " + text;
                Balloon(title, text, () => OpenPage(kind == "meeting" ? "/worker#send" : "/worker#pending"));
                return;
            }
            if (fresh.Count > 1)
            {
                Balloon(AppName, fresh.Count + " new standup items are waiting for you.", () => OpenPage("/worker#pending"));
                return;
            }

            // 4. New messages (project updates, shared or forwarded updates).
            if (lastUnread >= 0 && unread > lastUnread)
                Balloon("New message", "You have " + unread + " unread message" + (unread > 1 ? "s" : "") + ".", () => OpenPage("/worker#messages"));
        }

        async void JoinMeeting(string key, string link)
        {
            try
            {
                var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(Origin(server) + "/");
                var session = cookies.FirstOrDefault(c => c.Name == SessionCookie);
                if (session != null)
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, new Uri(server, "/api/worker/meeting/join"));
                    req.Headers.Add("Cookie", SessionCookie + "=" + session.Value);
                    req.Content = new StringContent(json.Serialize(new Dictionary<string, string> { { "key", key } }), System.Text.Encoding.UTF8, "application/json");
                    await http.SendAsync(req);
                }
            }
            catch { }
            if (!string.IsNullOrEmpty(link)) OpenExternal(link);
            else OpenPage("/worker#send");
        }

        async Task<Dictionary<string, object>> GetJson(string path, string session)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, new Uri(server, path));
            req.Headers.Add("Cookie", SessionCookie + "=" + session);
            using (var res = await http.SendAsync(req))
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized) return null;
                res.EnsureSuccessStatusCode();
                return json.Deserialize<Dictionary<string, object>>(await res.Content.ReadAsStringAsync());
            }
        }

        void Balloon(string title, string text, Action onClick)
        {
            balloonAction = onClick;
            tray.ShowBalloonTip(10000, Truncate(title, 60), Truncate(text, 250), ToolTipIcon.Info);
        }

        void SetTrayStatus(string status)
        {
            string name = Profiles.IsDefault(opts.Profile) ? AppName : AppName + " (" + opts.Profile + ")";
            tray.Text = Truncate(name + ": " + status, 63);
        }

        void OpenPage(string path)
        {
            ShowFromTray();
            if (webReady) web.CoreWebView2.Navigate(new Uri(server, path).ToString());
        }

        static List<Dictionary<string, object>> List(Dictionary<string, object> d, string key)
        {
            var list = new List<Dictionary<string, object>>();
            object v;
            if (d != null && d.TryGetValue(key, out v) && v is IEnumerable)
                foreach (var o in (IEnumerable)v) { var x = o as Dictionary<string, object>; if (x != null) list.Add(x); }
            return list;
        }
        static string Str(Dictionary<string, object> d, string key) { object v; return d.TryGetValue(key, out v) && v != null ? v.ToString() : ""; }
        static int Int(Dictionary<string, object> d, string key) { int n; return int.TryParse(Str(d, key), out n) ? n : 0; }
        static string TeamsOf(Dictionary<string, object> i) { var t = List2(i, "teams"); return t.Count > 0 ? string.Join(", ", t) : AppName; }
        static List<string> List2(Dictionary<string, object> d, string key)
        {
            var list = new List<string>();
            object v;
            if (d.TryGetValue(key, out v) && v is IEnumerable && !(v is string)) foreach (var o in (IEnumerable)v) list.Add(Convert.ToString(o));
            return list;
        }
        static bool TryToday(string hhmm, out DateTime when)
        {
            when = DateTime.MinValue;
            TimeSpan t;
            if (string.IsNullOrEmpty(hhmm) || !TimeSpan.TryParse(hhmm, out t)) return false;
            when = DateTime.Today + t;
            return true;
        }
        static string TimeText(Dictionary<string, object> i)
        {
            DateTime t;
            return TryToday(Str(i, "time"), out t) ? " at " + t.ToShortTimeString() : null;
        }
        static string Truncate(string s, int max) { s = s ?? ""; return s.Length <= max ? s : s.Substring(0, max - 3) + "..."; }

        /* ----------------------------------------------------------- tray menu */

        void BuildTrayMenu()
        {
            trayMenu.Items.Clear();
            var open = new ToolStripMenuItem("Open " + AppName, null, (s, e) => ShowFromTray());
            open.Font = new Font(open.Font, FontStyle.Bold);
            trayMenu.Items.Add(open);
            trayMenu.Items.Add(new ToolStripSeparator());

            var accounts = new ToolStripMenuItem("Accounts");
            accounts.DropDownItems.Add(new ToolStripMenuItem("This window: " + opts.Profile) { Enabled = false });
            foreach (var p in Profiles.All().Where(p => !string.Equals(p, opts.Profile, StringComparison.OrdinalIgnoreCase)))
            {
                string name = p;
                accounts.DropDownItems.Add(new ToolStripMenuItem("Open \"" + name + "\"", null, (s, e) => LaunchProfile(name)));
            }
            accounts.DropDownItems.Add(new ToolStripSeparator());
            accounts.DropDownItems.Add(new ToolStripMenuItem("Open another account...", null, (s, e) => NewProfile()));
            trayMenu.Items.Add(accounts);

            trayMenu.Items.Add(new ToolStripMenuItem("Notifications", null, (s, e) =>
            {
                settings.Notifications = !settings.Notifications;
                settings.Save();
            }) { Checked = settings.Notifications });
            trayMenu.Items.Add(new ToolStripMenuItem("Start with Windows", null, (s, e) =>
            {
                settings.StartWithWindows = !settings.StartWithWindows;
                Startup.Set(opts.Profile, settings.StartWithWindows);
                settings.Save();
            }) { Checked = settings.StartWithWindows });
            trayMenu.Items.Add(new ToolStripMenuItem("Change server address...", null, (s, e) => AskForServer(false)));
            trayMenu.Items.Add(new ToolStripMenuItem("Check for new requests now", null, async (s, e) => { firstPoll = true; seenKeys.Clear(); await PollAsync(); }));
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(new ToolStripMenuItem("Exit", null, (s, e) => ExitApp()));
        }

        void NewProfile()
        {
            string name = Prompt.Ask(Visible ? this : null, "Open another account",
                "Name for the other account's window, for example \"Test Worker\". It gets its own sign-in, separate from this one.", "Test Worker");
            if (string.IsNullOrEmpty(name)) return;
            name = Profiles.Clean(name);
            if (string.Equals(name, opts.Profile, StringComparison.OrdinalIgnoreCase)) { ShowFromTray(); return; }
            // New profiles start with the same server address as this one.
            var other = ProfileSettings.Load(name);
            if (string.IsNullOrWhiteSpace(other.ServerUrl) || !File.Exists(Path.Combine(Profiles.Folder(name), "settings.json")))
            {
                other.ServerUrl = server.ToString();
                other.Save();
            }
            LaunchProfile(name);
        }

        static void LaunchProfile(string name)
        {
            try { Process.Start(Application.ExecutablePath, "--profile \"" + name + "\""); } catch { }
        }

        bool AskForServer(bool firstRun)
        {
            string current = server != null ? Origin(server) : (settings.ServerUrl ?? "http://");
            for (;;)
            {
                string url = Prompt.Ask(Visible ? this : null, AppName,
                    firstRun ? "Enter the standup server address your administrator gave you, for example http://standup-pc:8080"
                             : "Standup server address (the app restarts after you change it):", current);
                if (url == null) return false;
                Uri u;
                if (!url.Contains("://")) url = "http://" + url;
                if (ProfileSettings.IsValidServer(url, out u))
                {
                    bool changed = server == null || !string.Equals(Origin(u), Origin(server), StringComparison.OrdinalIgnoreCase);
                    settings.ServerUrl = u.ToString();
                    settings.Save();
                    server = u;
                    if (!firstRun && changed) { reallyExit = true; tray.Visible = false; Application.Restart(); Environment.Exit(0); }
                    return true;
                }
                MessageBox.Show(this, "That doesn't look like a web address. It should look like http://server-name:8080", AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                current = url;
            }
        }

        /* -------------------------------------------------- window visibility */

        protected override void SetVisibleCore(bool value)
        {
            // When started with --background we stay in the tray until someone opens the window.
            if (!allowShow && value)
            {
                value = false;
                if (!IsHandleCreated) CreateHandle();
            }
            base.SetVisibleCore(value);
        }

        void ShowFromTray()
        {
            allowShow = true;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
        }

        void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (WindowState == FormWindowState.Normal) { settings.Width = Width; settings.Height = Height; settings.Save(); }
            if (reallyExit || e.CloseReason != CloseReason.UserClosing) { tray.Visible = false; return; }
            // Closing the window keeps the app in the tray so reminders keep working.
            e.Cancel = true;
            Hide();
            if (!settings.ToldAboutTray)
            {
                settings.ToldAboutTray = true;
                settings.Save();
                Balloon(AppName + " is still running", "It stays in the tray to remind you about standups. Right-click the tray icon and choose Exit to close it completely.", ShowFromTray);
            }
        }

        void ExitApp()
        {
            reallyExit = true;
            tray.Visible = false;
            pollTimer.Stop();
            Application.Exit();
        }

        static Icon LoadIcon(int size)
        {
            try
            {
                using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("app.ico"))
                    if (s != null) return new Icon(s, new Size(size, size));
            }
            catch { }
            return SystemIcons.Application;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                tray.Dispose();
                pollTimer.Dispose();
                if (http != null) http.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
