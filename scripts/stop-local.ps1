$FrontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 3000 }
$BackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8765 }
$ports = $FrontendPort, $BackendPort

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Stopped local services on ports $FrontendPort and $BackendPort."
