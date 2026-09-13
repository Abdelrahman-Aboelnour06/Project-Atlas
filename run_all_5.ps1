<#
.SYNOPSIS
  run_all_5.ps1 - Master runner for all 5 Project Atlas dimensions, test suites, or services.

.USAGE
  .\run_all_5.ps1                  # Runs All 5 Audits & Test Pillars (default)
  .\run_all_5.ps1 -Mode audit      # Runs All 5 Specialized Audit Dimensions
  .\run_all_5.ps1 -Mode tests      # Runs All 5 Core Test Suites
  .\run_all_5.ps1 -Mode services   # Starts All 5 Runtime Services
#>

param(
    [ValidateSet("all", "audit", "tests", "services")]
    [string]$Mode = "all"
)

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$VenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    $VenvPython = "python"
}

$ScriptPath = Join-Path $RootDir "run_all_5.py"

& $VenvPython $ScriptPath --mode $Mode
exit $LASTEXITCODE
