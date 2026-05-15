import { execFileSync } from "node:child_process";

export interface VanillaConsoleController {
  setVisible(childPid: number | undefined, visible: boolean): { hostPid?: number; windowHandle?: number; visible: boolean };
}

export class NoopVanillaConsoleController implements VanillaConsoleController {
  setVisible(): { visible: boolean } {
    return { visible: false };
  }
}

export class WindowsVanillaConsoleController implements VanillaConsoleController {
  setVisible(childPid: number | undefined, visible: boolean): { hostPid?: number; windowHandle?: number; visible: boolean } {
    if (!childPid) {
      throw new Error("Console process has no PID");
    }

    const script = `
$ErrorActionPreference = 'Stop'
$childPid = ${childPid}
$parentPid = ${process.pid}
$desiredVisible = ${visible ? "$true" : "$false"}
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class YconhostUser32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
}
'@
Add-Type $code -ErrorAction SilentlyContinue
function Convert-CimDate($value) {
  if ($value -is [datetime]) { return $value }
  return [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$value)
}
$child = Get-CimInstance Win32_Process -Filter "ProcessId=$childPid"
if (-not $child) { throw "Console process $childPid not found" }
$childStart = Convert-CimDate $child.CreationDate
$conhosts = Get-CimInstance Win32_Process -Filter "Name='conhost.exe' AND ParentProcessId=$parentPid"
$windows = New-Object System.Collections.Generic.List[object]
[YconhostUser32]::EnumWindows({
  param($hWnd, $lParam)
  $windowPid = [uint32]0
  [void][YconhostUser32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  $matchedConhost = $conhosts | Where-Object { [int]$_.ProcessId -eq [int]$windowPid } | Select-Object -First 1
  if ($matchedConhost) {
    $class = New-Object System.Text.StringBuilder 256
    [void][YconhostUser32]::GetClassName($hWnd, $class, $class.Capacity)
    if ($class.ToString() -eq 'PseudoConsoleWindow') {
      $hostStart = Convert-CimDate $matchedConhost.CreationDate
      $delta = [Math]::Abs(($hostStart - $childStart).TotalMilliseconds)
      $windows.Add([pscustomobject]@{ Pid = [int]$matchedConhost.ProcessId; Hwnd = $hWnd.ToInt64(); Delta = $delta }) | Out-Null
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$target = $windows | Sort-Object Delta | Select-Object -First 1
if (-not $target) { throw "PseudoConsoleWindow for process $childPid not found" }
$hwnd = [IntPtr]::new([int64]$target.Hwnd)
[void][YconhostUser32]::ShowWindow($hwnd, $(if ($desiredVisible) { 5 } else { 0 }))
Start-Sleep -Milliseconds 500
[pscustomobject]@{
  hostPid = $target.Pid
  windowHandle = $target.Hwnd
  visible = [YconhostUser32]::IsWindowVisible($hwnd)
} | ConvertTo-Json -Compress
`;

    const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8"
    }).trim();
    return JSON.parse(output) as { hostPid?: number; windowHandle?: number; visible: boolean };
  }
}

export function createVanillaConsoleController(): VanillaConsoleController {
  return process.platform === "win32" ? new WindowsVanillaConsoleController() : new NoopVanillaConsoleController();
}
