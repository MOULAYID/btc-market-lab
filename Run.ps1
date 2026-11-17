param([ValidateRange(1024,65535)][int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $python = if (Test-Path '.venv/Scripts/python.exe') { '.\.venv\Scripts\python.exe' } else { 'python' }
    if (-not (Test-Path 'dist/index.html')) {
        npm.cmd install
        if ($LASTEXITCODE) { throw 'npm install failed.' }
        npm.cmd run build
        if ($LASTEXITCODE) { throw 'Dashboard build failed.' }
    }
    Write-Host "Open http://127.0.0.1:$Port/ (Ctrl+C to stop)"
    & $python -m uvicorn server:app --host 127.0.0.1 --port $Port
} finally {
    Pop-Location
}
