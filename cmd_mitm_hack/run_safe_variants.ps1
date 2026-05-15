$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$createdCmdPids = New-Object System.Collections.Generic.List[int]

function Get-ConhostIds {
  @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Select-Object -ExpandProperty ProcessId)
}

function Stop-CreatedCmds {
  foreach ($createdPid in $createdCmdPids) {
    $proc = Get-Process -Id $createdPid -ErrorAction SilentlyContinue
    if ($proc) {
      & taskkill /PID $createdPid /T /F | Out-Null
    }
  }
}

function Invoke-Probe($name, [scriptblock]$action) {
  Remove-Item (Join-Path $root 'conhost_stub.log'), (Join-Path $root 'conhost_stub.ready') -ErrorAction SilentlyContinue
  $before = Get-ConhostIds
  $result = & $action
  Start-Sleep -Seconds 3
  $newConhosts = @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Where-Object { $before -notcontains $_.ProcessId })
  [pscustomobject]@{
    Name = $name
    ActionResult = $result
    StubLogExists = Test-Path (Join-Path $root 'conhost_stub.log')
    StubReadyExists = Test-Path (Join-Path $root 'conhost_stub.ready')
    NewConhosts = $newConhosts | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
    StubLog = if (Test-Path (Join-Path $root 'conhost_stub.log')) { Get-Content -Raw (Join-Path $root 'conhost_stub.log') } else { $null }
  }
}

function Invoke-CreateProcessProbe($mode) {
  $lines = @(& .\createprocess_probe.exe $mode 2>&1)
  $jsonLine = $lines | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
  if (-not $jsonLine) {
    throw "createprocess_probe.exe did not produce JSON for mode $mode. Output: $($lines -join "`n")"
  }
  $jsonLine | ConvertFrom-Json
}

Push-Location $root
try {
  $results = New-Object System.Collections.Generic.List[object]

  $results.Add((Invoke-Probe 'CreateProcess default with local cwd' {
    $json = Invoke-CreateProcessProbe default
    $createdCmdPids.Add([int]$json.pid)
    $json
  })) | Out-Null

  $results.Add((Invoke-Probe 'CreateProcess CREATE_NEW_CONSOLE with local cwd' {
    $json = Invoke-CreateProcessProbe new-console
    $createdCmdPids.Add([int]$json.pid)
    $json
  })) | Out-Null

  $results.Add((Invoke-Probe 'CreateProcess with PATH prepended' {
    $oldPath = $env:PATH
    $env:PATH = "$root;$oldPath"
    try {
      $json = Invoke-CreateProcessProbe new-console
      $createdCmdPids.Add([int]$json.pid)
      $json
    } finally {
      $env:PATH = $oldPath
    }
  })) | Out-Null

  $results.Add((Invoke-Probe 'HKCU App Paths conhost.exe temporary' {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\conhost.exe'
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name '(default)' -Value (Join-Path $root 'conhost.exe') -PropertyType String -Force | Out-Null
    try {
      $cmd = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList '/K','echo app-paths-probe' -WorkingDirectory $root -WindowStyle Normal -PassThru
      $createdCmdPids.Add([int]$cmd.Id)
      [pscustomobject]@{ pid = $cmd.Id }
    } finally {
      Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
    }
  })) | Out-Null

  $results | ConvertTo-Json -Depth 8
} finally {
  Stop-CreatedCmds
  Pop-Location
}
