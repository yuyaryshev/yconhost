$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  $gcc = (Get-Command gcc.exe -ErrorAction Stop).Source
  & $gcc -Wall -Wextra -O2 -o conhost.exe conhost_stub.c
  if ($LASTEXITCODE -ne 0) {
    throw "gcc failed with exit code $LASTEXITCODE"
  }
  Get-Item .\conhost.exe | Select-Object FullName,Length,LastWriteTime
} finally {
  Pop-Location
}
