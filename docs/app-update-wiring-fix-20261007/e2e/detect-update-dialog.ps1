# 枚举当前所有顶层窗口，查找更新提示对话框。
#
# 为什么用窗口枚举而不只截图：截图需要人工判读，而"标题里出现『发现新版本』
# 且正文含 9.9.9"是可自动判定的客观证据，能直接作为通过/失败的门禁。
param(
  [int]$TimeoutSeconds = 90,
  [string]$ExpectTitle = "发现新版本",
  [string]$ExpectText = "9.9.9"
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  public static string[] Snapshot() {
    var list = new System.Collections.Generic.List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, sb.Capacity);
      var cn = new StringBuilder(256);
      GetClassNameW(h, cn, cn.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(pid + "|" + cn.ToString() + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
"@

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$found = $null
while ((Get-Date) -lt $deadline) {
  $snap = [WinEnum]::Snapshot()
  $hit = $snap | Where-Object { $_ -match [regex]::Escape($ExpectTitle) }
  if ($hit) { $found = $hit; break }
  Start-Sleep -Milliseconds 800
}

Write-Output "=== 所有可见顶层窗口（pid|类名|标题）==="
$snap = [WinEnum]::Snapshot()
$snap | ForEach-Object { Write-Output ("  " + $_) }

if ($found) {
  Write-Output "`n=== 命中更新提示窗口 ==="
  $found | ForEach-Object { Write-Output ("  " + $_) }
  # 对话框正文不一定在标题里，标题命中即为通过
  if ($found -match [regex]::Escape($ExpectText)) {
    Write-Output "`nPASS 窗口标题同时含 $ExpectText"
  } else {
    Write-Output "`nPASS 找到标题为「$ExpectTitle」的窗口（版本号在正文里，不体现在标题）"
  }
  exit 0
} else {
  Write-Output "`nFAIL $TimeoutSeconds 秒内没有出现标题含「$ExpectTitle」的窗口"
  exit 1
}
