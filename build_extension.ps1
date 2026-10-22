# build_extension.ps1 - Audit, package, and sign Project Atlas Chrome Extension.
param(
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$PythonExe = Join-Path $RootDir "backend\venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
}

$ScriptPath = Join-Path $RootDir "tools\package_extension.py"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Project Atlas -- Extension Release Packaging Pipeline   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ArgsList = @($ScriptPath)
if ($VerifyOnly) {
    $ArgsList += "--verify-only"
}

& $PythonExe @ArgsList
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Packaging failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "[SUCCESS] Extension pipeline completed successfully." -ForegroundColor Green
