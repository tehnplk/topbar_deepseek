param(
  [int]$IntervalMs = 700,
  [switch]$Once
)

# Reads the HN of the patient that is open in HOSxP, including modal dialogs
# (e.g. TPatientVisitEntryForm) that are separate top-level windows.
#
# HOSxP is a Delphi/DevExpress application: its editors draw their text, so
# WM_GETTEXT returns nothing. Values are read with MSAA
# (oleacc!AccessibleObjectFromWindow -> IAccessible.get_accValue).
#
# Detection order for every visible HOSxP window (foreground first):
#   1. HN in the window caption, e.g. "TPatientOPDCardForm:000000000"
#   2. edit control next to a visible "HN" label (MSAA value)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
using Accessibility;

public class HosxpHnReader
{
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);

    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    const uint OBJID_CLIENT = 0xFFFFFFFC;
    static IntPtr mainForm = IntPtr.Zero;
    static uint mainPid = 0;

    static string Text(IntPtr h) { var sb = new StringBuilder(1024); GetWindowTextW(h, sb, sb.Capacity); return sb.ToString(); }
    static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassNameW(h, sb, sb.Capacity); return sb.ToString(); }

    static string Acc(IntPtr h, bool wantValue)
    {
        Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
        object o;
        if (AccessibleObjectFromWindow(h, OBJID_CLIENT, ref iid, out o) != 0 || o == null) return null;
        var a = o as IAccessible;
        if (a == null) return null;
        try { return wantValue ? a.get_accValue(0) : a.get_accName(0); }
        catch { return null; }
    }

    static bool IsHnText(string s)
    {
        if (string.IsNullOrEmpty(s)) return false;
        s = s.Trim();
        if (s.Length < 5 || s.Length > 9) return false;
        foreach (char c in s) if (!char.IsDigit(c)) return false;
        return true;
    }

    // Some screens keep the HN in the caption: "TPatientOPDCardForm:000000000 - ..."
    static string TitleHn(string title)
    {
        var m = System.Text.RegularExpressions.Regex.Match(title, @":(\d{5,9})(?:\D|$)");
        return m.Success ? m.Groups[1].Value : null;
    }

    // Value of an edit control. DevExpress keeps the text on the inner editor.
    static string EditValue(IntPtr h)
    {
        string v = Acc(h, true);
        if (!string.IsNullOrEmpty(v)) return v.Trim();

        IntPtr inner = IntPtr.Zero;
        EnumChildWindows(h, (ch, l) =>
        {
            if (Cls(ch).IndexOf("Inner", StringComparison.Ordinal) >= 0) { inner = ch; return false; }
            return true;
        }, IntPtr.Zero);

        if (inner != IntPtr.Zero)
        {
            v = Acc(inner, true);
            if (!string.IsNullOrEmpty(v)) return v.Trim();
            v = Acc(inner, false);
            if (!string.IsNullOrEmpty(v)) return v.Trim();
        }

        v = Acc(h, false);
        return v == null ? null : v.Trim();
    }

    static void FindMain()
    {
        IntPtr best = IntPtr.Zero;
        long bestScore = -1;

        EnumWindows((h, l) =>
        {
            string c = Cls(h);
            if ((c == "TMainForm" || c.StartsWith("THOSxP")) &&
                Text(h).IndexOf("HOSxP", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                RECT r;
                long area = GetWindowRect(h, out r) ? (long)(r.Right - r.Left) * (r.Bottom - r.Top) : 0;
                long score = (IsWindowVisible(h) ? (1L << 60) : 0) + area;
                if (score > bestScore) { bestScore = score; best = h; }
            }
            return true;
        }, IntPtr.Zero);

        mainForm = best;
        if (mainForm != IntPtr.Zero) GetWindowThreadProcessId(mainForm, out mainPid);
    }

    // Ignore tool windows / popups that never host a patient form.
    static bool IsCandidate(IntPtr h)
    {
        if (!IsWindowVisible(h)) return false;

        string c = Cls(h);
        if (c == "TApplication" || c == "IME" || c == "MSCTFIME UI") return false;
        if (c.StartsWith("TPUtilWindow") || c.StartsWith("Tdx") || c.StartsWith("Tcx")) return false;
        if (c.StartsWith("Rtc") || c.StartsWith("GDI+") || c.StartsWith("mad")) return false;

        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        int w = r.Right - r.Left;
        int hgt = r.Bottom - r.Top;
        if (w < 200 || hgt < 100) return false;

        uint pid;
        GetWindowThreadProcessId(h, out pid);
        return pid == mainPid;
    }

    static string ReadFromForm(IntPtr form)
    {
        string result = null;

        EnumChildWindows(form, (h, l) =>
        {
            if (Cls(h) != "TcxLabel") return true;
            string t = Text(h).Trim();
            if (!t.StartsWith("HN", StringComparison.OrdinalIgnoreCase)) return true;

            RECT lr;
            if (!GetWindowRect(h, out lr)) return true;

            IntPtr bestEdit = IntPtr.Zero;
            int bestDx = int.MaxValue;

            EnumChildWindows(form, (e, l2) =>
            {
                string ec = Cls(e);
                if (ec.IndexOf("Edit", StringComparison.Ordinal) < 0) return true;
                RECT er;
                if (!GetWindowRect(e, out er)) return true;
                if (er.Top >= lr.Bottom || er.Bottom <= lr.Top) return true;
                int dx = er.Left - lr.Right;
                if (dx < -8) return true;
                if (dx < bestDx) { bestDx = dx; bestEdit = e; }
                return true;
            }, IntPtr.Zero);

            if (bestEdit != IntPtr.Zero)
            {
                string v = EditValue(bestEdit);
                if (v != null && IsHnText(v))
                {
                    result = v.Trim();
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);

        return result;
    }

    static string Escape(string s)
    {
        if (s == null) return "null";
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static string Result(string hn, string source)
    {
        return "{\"running\":true,\"hn\":" + Escape(hn) + ",\"form\":" + Escape(source) + "}";
    }

    public static string Poll()
    {
        FindMain();
        if (mainForm == IntPtr.Zero) return "{\"running\":false,\"hn\":null,\"form\":null}";

        IntPtr fg = GetForegroundWindow();

        // Candidate top-level windows: foreground first, then the main form,
        // then the remaining HOSxP windows by area.
        var windows = new List<IntPtr>();
        EnumWindows((h, l) =>
        {
            if (h != fg && IsCandidate(h)) windows.Add(h);
            return true;
        }, IntPtr.Zero);

        windows.Sort((a, b) =>
        {
            RECT ra, rb;
            GetWindowRect(a, out ra);
            GetWindowRect(b, out rb);
            long areaA = (long)(ra.Right - ra.Left) * (ra.Bottom - ra.Top);
            long areaB = (long)(rb.Right - rb.Left) * (rb.Bottom - rb.Top);
            return areaB.CompareTo(areaA);
        });

        if (fg != IntPtr.Zero && IsCandidate(fg)) windows.Insert(0, fg);
        if (mainForm != IntPtr.Zero && !windows.Contains(mainForm)) windows.Insert(0, mainForm);

        foreach (var w in windows)
        {
            string caption = Text(w);
            string fromCaption = TitleHn(caption);
            if (fromCaption != null) return Result(fromCaption, "caption");
        }

        foreach (var w in windows)
        {
            string hn = ReadFromForm(w);
            if (hn != null) return Result(hn, Cls(w));
        }

        return "{\"running\":true,\"hn\":null,\"form\":null}";
    }
}
'@

if ($Once) {
  [Console]::Out.WriteLine([HosxpHnReader]::Poll())
  exit 0
}

$last = ''
while ($true) {
  try { $line = [HosxpHnReader]::Poll() } catch { $line = '{"running":false,"hn":null,"form":null}' }
  if ($line -ne $last) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $last = $line
  }
  Start-Sleep -Milliseconds $IntervalMs
}
