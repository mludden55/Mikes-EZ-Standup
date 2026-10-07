using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace MikesEZStandup
{
    /// <summary>Command line: --profile "Name"  --background</summary>
    public class Options
    {
        public string Profile = "Default";
        public bool Background;

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if ((a == "--profile" || a == "-p") && i + 1 < args.Length) o.Profile = args[++i];
                else if (a.StartsWith("--profile=")) o.Profile = a.Substring("--profile=".Length);
                else if (a == "--background") o.Background = true;
            }
            o.Profile = Profiles.Clean(o.Profile);
            return o;
        }
    }

    public static class Profiles
    {
        public const string DefaultName = "Default";

        public static string Root
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MikesEZStandup", "Profiles"); }
        }

        /// <summary>Profile names become folder names, so keep them simple.</summary>
        public static string Clean(string name)
        {
            var sb = new StringBuilder();
            foreach (char c in (name ?? "").Trim())
                if (char.IsLetterOrDigit(c) || c == ' ' || c == '-' || c == '_') sb.Append(c);
            string s = sb.ToString().Trim();
            if (s.Length > 40) s = s.Substring(0, 40).Trim();
            return s.Length == 0 ? DefaultName : s;
        }

        public static bool IsDefault(string name) { return string.Equals(name, DefaultName, StringComparison.OrdinalIgnoreCase); }

        public static string Folder(string name) { return Path.Combine(Root, name); }

        public static List<string> All()
        {
            if (!Directory.Exists(Root)) return new List<string>();
            return Directory.GetDirectories(Root).Select(Path.GetFileName).OrderBy(n => n).ToList();
        }
    }

    /// <summary>Per-profile settings, stored in %LOCALAPPDATA%\MikesEZStandup\Profiles\NAME\settings.json</summary>
    public class ProfileSettings
    {
        public string ServerUrl { get; set; }
        public bool Notifications { get; set; }
        public bool StartWithWindows { get; set; }
        public bool AskedAboutStartup { get; set; }
        public bool ToldAboutTray { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }

        [ScriptIgnore] public string ProfileName { get; private set; }

        static string FileFor(string profile) { return Path.Combine(Profiles.Folder(profile), "settings.json"); }

        public static ProfileSettings Load(string profile)
        {
            ProfileSettings s = null;
            try
            {
                string f = FileFor(profile);
                if (File.Exists(f)) s = new JavaScriptSerializer().Deserialize<ProfileSettings>(File.ReadAllText(f));
            }
            catch { /* a damaged settings file just means defaults */ }
            if (s == null) s = new ProfileSettings { Notifications = true, Width = 1150, Height = 850 };
            s.ProfileName = profile;
            if (string.IsNullOrWhiteSpace(s.ServerUrl)) s.ServerUrl = DefaultServerUrl();
            return s;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Profiles.Folder(ProfileName));
                File.WriteAllText(FileFor(ProfileName), new JavaScriptSerializer().Serialize(this));
            }
            catch { }
        }

        /// <summary>The installer puts MikesEZStandup.json (with the server address) next to the program.</summary>
        public static string DefaultServerUrl()
        {
            try
            {
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                foreach (string f in new[] { Path.Combine(dir, "MikesEZStandup.json"), Path.Combine(dir, "..", "MikesEZStandup.json") })
                {
                    if (!File.Exists(f)) continue;
                    var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(f));
                    object v;
                    if (d != null && d.TryGetValue("serverUrl", out v) && v != null) return v.ToString();
                }
            }
            catch { }
            return null;
        }

        public static bool IsValidServer(string url, out Uri uri)
        {
            uri = null;
            if (string.IsNullOrWhiteSpace(url)) return false;
            Uri u;
            if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out u)) return false;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return false;
            uri = new Uri(u.GetLeftPart(UriPartial.Authority) + "/");
            return true;
        }
    }

    /// <summary>"Start with Windows" via HKCU\...\Run (no admin rights needed).</summary>
    public static class Startup
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        static string ValueName(string profile) { return Profiles.IsDefault(profile) ? "MikesEZStandup" : "MikesEZStandup (" + profile + ")"; }

        public static void Set(string profile, bool on)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (on)
                    {
                        string cmd = "\"" + System.Windows.Forms.Application.ExecutablePath + "\" --background";
                        if (!Profiles.IsDefault(profile)) cmd += " --profile \"" + profile + "\"";
                        key.SetValue(ValueName(profile), cmd);
                    }
                    else key.DeleteValue(ValueName(profile), false);
                }
            }
            catch { }
        }
    }
}
