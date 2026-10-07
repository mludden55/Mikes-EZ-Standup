using System;
using System.Threading;
using System.Windows.Forms;

namespace MikesEZStandup
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            var opts = Options.Parse(args);

            // One running copy per profile. Starting it again just brings the window forward,
            // while a different profile (e.g. "Test Worker") runs as its own separate copy.
            string id = "MikesEZStandup_" + opts.Profile.Replace(' ', '_').ToLowerInvariant();
            bool firstCopy;
            using (var mutex = new Mutex(true, id, out firstCopy))
            {
                if (!firstCopy)
                {
                    try { using (var ev = EventWaitHandle.OpenExisting(id + "_show")) ev.Set(); } catch { }
                    return;
                }
                using (var showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, id + "_show"))
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new MainForm(opts, showSignal));
                }
                GC.KeepAlive(mutex);
            }
        }
    }
}
