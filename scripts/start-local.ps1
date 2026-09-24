$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Logs = Join-Path $Root "logs"
$BackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8765 }
$FrontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 3000 }
$ApiBase = if ($env:NEXT_PUBLIC_API_BASE) { $env:NEXT_PUBLIC_API_BASE } else { "http://localhost:$BackendPort" }

New-Item -ItemType Directory -Force $Logs | Out-Null

function Stop-PortProcess {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $processId = $connection.OwningProcess
    if ($processId -and $processId -ne $PID) {
      Write-Host "Stopping existing process on port $Port (PID: $processId)"
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Resolve-Python {
  $venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
  if (Test-Path $venvPython) { return $venvPython }

  $python = Get-Command py -ErrorAction SilentlyContinue
  if ($python) {
    Push-Location $Backend
    try {
      py -3.11 -m venv .venv 2>$null
      if (-not (Test-Path $venvPython)) { py -3 -m venv .venv }
    } finally { Pop-Location }
  } else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { throw "Python was not found. Install Python 3.11+ and try again." }
    Push-Location $Backend
    try { python -m venv .venv } finally { Pop-Location }
  }

  if (-not (Test-Path $venvPython)) { throw "Failed to create backend virtual environment." }
  return $venvPython
}

Stop-PortProcess $FrontendPort
Stop-PortProcess $BackendPort

$pythonExe = Resolve-Python

Push-Location $Backend
try {
  & $pythonExe -m pip install --disable-pip-version-check -r requirements.txt
  & $pythonExe -m playwright install chromium
} finally {
  Pop-Location
}

Push-Location $Frontend
try {
  if (-not (Test-Path "node_modules")) {
    npm ci
  }
} finally {
  Pop-Location
}

$env:DEBUG = if ($env:DEBUG) { $env:DEBUG } else { "true" }
$env:NEXT_PUBLIC_API_BASE = $ApiBase

Start-Process -FilePath $pythonExe `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort" `
  -WorkingDirectory $Backend `
  -RedirectStandardOutput (Join-Path $Logs "backend.out.log") `
  -RedirectStandardError (Join-Path $Logs "backend.err.log") `
  -WindowStyle Hidden

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "dev", "--", "--webpack", "--port", "$FrontendPort" `
  -WorkingDirectory $Frontend `
  -RedirectStandardOutput (Join-Path $Logs "frontend.out.log") `
  -RedirectStandardError (Join-Path $Logs "frontend.err.log") `
  -WindowStyle Hidden

Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "API docs: http://localhost:$BackendPort/docs"
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Logs:     $Logs"
