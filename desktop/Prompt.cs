using System;
using System.Drawing;
using System.Windows.Forms;

namespace MikesEZStandup
{
    /// <summary>A small "type a value" dialog.</summary>
    public static class Prompt
    {
        public static string Ask(IWin32Window owner, string title, string message, string value)
        {
            using (var f = new Form())
            {
                f.Text = title;
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.StartPosition = owner == null ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent;
                f.MinimizeBox = false;
                f.MaximizeBox = false;
                f.ShowInTaskbar = owner == null;
                f.AutoScaleMode = AutoScaleMode.Dpi;
                f.ClientSize = new Size(460, 150);
                f.Font = SystemFonts.MessageBoxFont;

                var label = new Label { Text = message, Left = 14, Top = 12, Width = 432, Height = 44 };
                var box = new TextBox { Text = value ?? "", Left = 14, Top = 62, Width = 432 };
                var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Left = 280, Top = 104, Width = 80 };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Left = 366, Top = 104, Width = 80 };
                f.Controls.AddRange(new Control[] { label, box, ok, cancel });
                f.AcceptButton = ok;
                f.CancelButton = cancel;
                f.Shown += (s, e) => { box.Focus(); box.SelectAll(); };
                return f.ShowDialog(owner) == DialogResult.OK ? box.Text.Trim() : null;
            }
        }
    }
}
