$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  Remove-Item .\conhost_stub.log, .\conhost_stub.ready -ErrorAction SilentlyContinue

  $beforeConhosts = @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Select-Object -ExpandProperty ProcessId)
  $cmd = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
    -ArgumentList '/K', 'echo fake-conhost-probe' `
    -WorkingDirectory $root `
    -WindowStyle Normal `
    -PassThru

  Start-Sleep -Seconds 3

  $afterConhosts = @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Where-Object { $beforeConhosts -notcontains $_.ProcessId })
  $cmdProcess = Get-Process -Id $cmd.Id -ErrorAction SilentlyContinue
  $result = [pscustomobject]@{
    StartedCmdPid = $cmd.Id
    CmdMainWindowHandle = $cmdProcess.MainWindowHandle
    CmdMainWindowTitle = $cmdProcess.MainWindowTitle
    StubLogExists = Test-Path .\conhost_stub.log
    StubReadyExists = Test-Path .\conhost_stub.ready
    NewConhosts = $afterConhosts | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
    StubLog = if (Test-Path .\conhost_stub.log) { Get-Content -Raw .\conhost_stub.log } else { $null }
  }

  $result | ConvertTo-Json -Depth 6
} finally {
  Pop-Location
}
