$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  $gcc = (Get-Command gcc.exe -ErrorAction Stop).Source
  & $gcc -Wall -Wextra -O2 -o conhost.exe conhost_stub.c
  if ($LASTEXITCODE -ne 0) {
    throw "gcc failed with exit code $LASTEXITCODE"
  }
  & $gcc -Wall -Wextra -O2 -o createprocess_probe.exe createprocess_probe.c
  if ($LASTEXITCODE -ne 0) {
    throw "gcc failed with exit code $LASTEXITCODE"
  }
  Get-Item .\conhost.exe | Select-Object FullName,Length,LastWriteTime
  Get-Item .\createprocess_probe.exe | Select-Object FullName,Length,LastWriteTime
} finally {
  Pop-Location
}
