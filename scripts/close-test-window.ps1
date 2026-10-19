param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
# Test-only: close GUI windows belonging to this exact isolated test executable.
# Never terminate a process and never match solely on its name.
$resolvedExecutable=[IO.Path]::GetFullPath($Executable)
$qaRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts\qa')) + '\'
if(-not $resolvedExecutable.StartsWith($qaRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing a target outside artifacts/qa.'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TestWindowClose {
  public delegate bool Callback(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static void Close(uint pid) { EnumWindows((hwnd,state)=> { uint windowPid; GetWindowThreadProcessId(hwnd,out windowPid); if(windowPid==pid) PostMessage(hwnd,0x0010,IntPtr.Zero,IntPtr.Zero);return true;},IntPtr.Zero); }
}
'@
$matches=Get-Process | Where-Object {try{$_.Path -eq $resolvedExecutable}catch{$false}}
foreach($process in $matches){[TestWindowClose]::Close([uint32]$process.Id)}
