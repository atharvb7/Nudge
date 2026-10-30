# One command to set up and run Nudge locally (Windows PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1
#   add -Ml to also install MiniLM + ChromaDB for semantic search (~1 GB)
param([switch]$Ml)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$Root = Get-Location

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Please install Node.js 18+ (https://nodejs.org)" }
$Py = Get-Command py -ErrorAction SilentlyContinue
if (-not $Py) { $Py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $Py) { throw "Please install Python 3.10+ (https://python.org)" }

Write-Host "`n> Installing JavaScript packages" -ForegroundColor Green
npm install --no-audit --no-fund
Write-Host "`n> Building the Chrome extension -> extension\dist" -ForegroundColor Green
npm run build -w extension

Write-Host "`n> Setting up the backend (backend\.venv)" -ForegroundColor Green
if (-not (Test-Path backend\.venv)) { & $Py.Source -m venv backend\.venv }
& backend\.venv\Scripts\pip.exe install -q -r backend\requirements-dev.txt
if ($Ml) { & backend\.venv\Scripts\pip.exe install -q -r backend\requirements-ml.txt }

Write-Host "`n> Building the dashboard" -ForegroundColor Green
npm run build -w dashboard

$back = Start-Process -PassThru -NoNewWindow -WorkingDirectory backend -FilePath ".venv\Scripts\uvicorn.exe" -ArgumentList "app.main:app","--port","8000","--no-access-log"
$dash = Start-Process -PassThru -NoNewWindow -FilePath "npm.cmd" -ArgumentList "run","start","-w","dashboard"

Write-Host @"

Nudge is running.
  Backend   http://localhost:8000/health
  Dashboard http://localhost:3000

Load the extension (once): chrome://extensions -> Developer mode -> Load unpacked ->
  $Root\extension\dist
Open it with Ctrl+Shift+Space or the toolbar icon.

Press Enter here to stop everything.
"@
Read-Host | Out-Null
Stop-Process -Id $back.Id, $dash.Id -ErrorAction SilentlyContinue
