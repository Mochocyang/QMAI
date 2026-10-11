# 启动被测应用，同时观测两件事，用来区分「修复没生效」与「网络请求失败」：
#   1) 是否出现「发现新版本」窗口（枚举所有顶层窗口，不只主窗口）
#   2) 被测进程建立了哪些远端 TCP 连接（判断它到底有没有发出更新请求）
#
# 背景：发布后第一次验证没弹出提示，而应用界面完整运行。只看"有没有弹窗"
# 无法区分这两种原因，所以需要连接层面的证据。
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [int]$TimeoutSeconds = 120,
  [string]$ExpectTitle = "发现新版本"
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnumNet {
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
      var sb = new StringBuilder(512); GetWindowTextW(h, sb, sb.Capacity);
      var cn = new StringBuilder(256); GetClassNameW(h, cn, cn.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(pid + "|" + cn.ToString() + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
"@

$proc = Start-Process -FilePath $Exe -PassThru
Write-Output ("  已启动 pid = " + $proc.Id)

$seen = @{}
$dialogFound = $false
$exited = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { $exited = $true; break }

  try {
    $conns = Get-NetTCPConnection -OwningProcess $proc.Id -ErrorAction SilentlyContinue |
      Where-Object { $_.RemoteAddress -and $_.RemoteAddress -ne "0.0.0.0" -and $_.RemoteAddress -ne "::" }
    foreach ($c in $conns) {
      $key = $c.RemoteAddress + ":" + $c.RemotePort
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = (Get-Date).ToString("HH:mm:ss") + "  " + $c.State
      }
    }
  } catch { }

  $snap = [WinEnumNet]::Snapshot()
  if ($snap | Where-Object { $_ -match [regex]::Escape($ExpectTitle) -and $_ -match ("^" + $proc.Id + "\|") }) {
    $dialogFound = $true
    break
  }
  Start-Sleep -Milliseconds 700
}

Write-Output ""
if ($exited) {
  Write-Output ("  !! 进程已退出（退出码 " + $proc.ExitCode + "）—— 这属于崩溃，而不是「没发起请求」")
} else {
  Write-Output ("  进程仍在运行")
}

if ($seen.Count -gt 0) {
  Write-Output ("  观测到 " + $seen.Count + " 个远端连接目标：")
  foreach ($k in $seen.Keys) { Write-Output ("    " + $k + "   " + $seen[$k]) }
} else {
  Write-Output "  未观测到任何远端连接 —— 应用很可能没有发起更新请求"
}

Write-Output ""
$snap = [WinEnumNet]::Snapshot()
Write-Output "  该进程当前可见窗口："
$snap | Where-Object { $_ -match ("^" + $proc.Id + "\|") } | ForEach-Object { Write-Output ("    " + $_) }

if ($dialogFound) {
  Write-Output "`n  PASS 出现「$ExpectTitle」窗口"
  exit 0
} else {
  Write-Output "`n  FAIL 未出现更新提示窗口"
  exit 1
}
