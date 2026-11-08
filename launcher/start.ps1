# Starts the HENSHIN dev server (if not already running) and opens it in an app window.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:5173/'

function Up { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch { $false } }

if (-not (Up)) {
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Start-Process cmd.exe -ArgumentList '/c', 'npm install && npm run setup' -WorkingDirectory $root -Wait
  }
  Start-Process cmd.exe -ArgumentList '/c', 'npm run dev -- --port 5173 --strictPort' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 60 -and -not (Up); $i++) { Start-Sleep -Milliseconds 500 }
}

$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$b = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($b) { Start-Process $b -ArgumentList "--app=$url", '--window-size=1280,800' }
else { Start-Process $url }
