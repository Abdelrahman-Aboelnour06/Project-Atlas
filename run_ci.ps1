<#
.SYNOPSIS
  run_ci.ps1 - Atlas CI/CD Pipeline Local Runner
  Executes Security, Unit, Module, System, and Gatekeeper tests locally to ensure code remains stable.

.USAGE
  .\run_ci.ps1               # Runs all tiers (Security, Unit, Module, System, Gatekeeper)
  .\run_ci.ps1 -Stage security # Runs only Security tests
  .\run_ci.ps1 -Stage unit   # Runs only Unit tests
  .\run_ci.ps1 -Stage module # Runs only Module tests
  .\run_ci.ps1 -Stage system # Runs only System tests
  .\run_ci.ps1 -Stage verify # Runs only Gatekeeper self-check
#>

param(
    [ValidateSet("all", "security", "unit", "module", "system", "verify")]
    [string]$Stage = "all"
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$ClientScriptDir = Join-Path $RootDir "client-script"
$DashboardDir = Join-Path $RootDir "dashboard"
$DemoSiteDir = Join-Path $RootDir "demo-site"
$CiDir = Join-Path $RootDir "ci"

$VenvPython = Join-Path $BackendDir "venv_linux\bin\python"
if (-not (Test-Path $VenvPython)) {
    $VenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
    if (-not (Test-Path $VenvPython)) {
        $VenvPython = Join-Path $BackendDir "venv\bin\python"
        if (-not (Test-Path $VenvPython)) {
            $VenvPython = "python"
        }
    }
}

function Write-Banner ($title) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Run-Step ($stepName, [scriptblock]$action) {
    Write-Host ">>> [RUNNING] $stepName" -ForegroundColor Yellow
    try {
        & $action
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            Write-Host ">>> [FAILED]  $stepName (Exit code: $LASTEXITCODE)" -ForegroundColor Red
            exit $LASTEXITCODE
        }
        Write-Host ">>> [PASSED]  $stepName" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host ">>> [ERROR]   $stepName - $_" -ForegroundColor Red
        exit 1
    }
}

Write-Banner "Atlas CI/CD Pipeline - Stage: $Stage"

# -----------------------------------------------------------------------------
# 0. SECURITY QUALITY GATE TIER
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "security") {
    Write-Host "-- TIER 0: SECURITY QUALITY GATE -----------------------" -ForegroundColor Red

    Run-Step "Security: Ensure No .env Files Tracked in Git" {
        $trackedEnv = git ls-files | Select-String -Pattern '(\.env$|\.env\.)'
        if ($trackedEnv) {
            throw "Security Gate Failure: Tracked .env files detected in repository: $trackedEnv"
        }
        Write-Host "    [OK] No .env secrets files tracked in repository" -ForegroundColor Green
    }

    Run-Step "Security: Extension Security Quality Gates and AST Audit" {
        node (Join-Path $ClientScriptDir "test_extension.js")
    }

    Run-Step "Security: Security & Resilience Tests" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_security_resilience.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "Security & Transactions: Universal Auth Gates & DB Transaction Integrity" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_auth_and_transactions.py -v --tb=short
        } finally {
            Pop-Location
        }
    }
}

# -----------------------------------------------------------------------------
# 1. UNIT TESTING TIER
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "unit") {
    Write-Host "-- TIER 1: UNIT TESTS ----------------------------------" -ForegroundColor Green

    Run-Step "Unit: Extension Script Syntax & Manifest Integrity" { node (Join-Path $ClientScriptDir "test_extension.js") }
    Run-Step "Unit: WebCrypto Secret Vault" { node (Join-Path $ClientScriptDir "test_secret_vault.js") }
    Run-Step "Unit: DOM Serializer v2 ARIA Heuristics" { node (Join-Path $ClientScriptDir "test_dom_serializer_v2.js") }
    Run-Step "Unit: Goal Store Session Persistence" { node (Join-Path $ClientScriptDir "test_goal_store.js") }
    Run-Step "Unit: Executor Action Verbs" { node (Join-Path $ClientScriptDir "test_executor_v2.js") }
    Run-Step "Unit: WebSocket Client Stress & Resilience" { node (Join-Path $ClientScriptDir "test_ws_client_stress.js") }
    Run-Step "Unit: Adversarial RTL Bidi & Dual-Language" { node (Join-Path $ClientScriptDir "test_m7_adversarial_challenger2.js") }
    Run-Step "Unit: Sidebar UI Behavior & Clamping" { node (Join-Path $ClientScriptDir "test_sidebar_behavior.js") }
    Run-Step "Unit: Demo Site Fixtures Integrity" { node (Join-Path $DemoSiteDir "test_fixtures.js") }

    Run-Step "Unit: Backend Data Models" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_models.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "Unit: Action & Simplify Parsers" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_action_parser.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "Unit: Rate Limiter Logic" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_rate_limiter.py -v --tb=short
        } finally {
            Pop-Location
        }
    }
}

# -----------------------------------------------------------------------------
# 2. MODULE TESTING TIER
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "module") {
    Write-Host "-- TIER 2: MODULE TESTS --------------------------------" -ForegroundColor Blue

    Run-Step "Module: Complete Backend Pytest Suites" {
        Push-Location $BackendDir
        try {
            $env:LLM_PROVIDER = "mock"
            & $VenvPython -m pytest tests/ -v --tb=short
        } finally {
            Pop-Location
        }
    }

    if (Test-Path (Join-Path $DashboardDir "node_modules")) {
        Run-Step "Module: Dashboard Next.js Type Check and Compilation" {
            Push-Location $DashboardDir
            try {
                npm run build
            } finally {
                Pop-Location
            }
        }
    }
}

# -----------------------------------------------------------------------------
# 3. SYSTEM & E2E TESTING TIER
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "system") {
    Write-Host "-- TIER 3: SYSTEM & E2E TESTS --------------------------" -ForegroundColor Magenta

    Run-Step "System: WebSocket Agent Pipeline" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_websocket.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "System: Complete Multi-Service End-to-End Workflow" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_system_e2e.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "System: Replay Scenarios Runner" {
        Push-Location $BackendDir
        try {
            $env:LLM_PROVIDER = "mock"
            & $VenvPython -m pytest tests/replay/test_replay_runner.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    Run-Step "System: Playwright E2E Extension Harness" {
        node (Join-Path $RootDir "ci\e2e\harness.js")
    }

    Run-Step "System: Playwright UI Sidebar Behavior Harness" {
        node (Join-Path $RootDir "ci\e2e\ui_sidebar_behavior.js")
    }

    Run-Step "System: Playwright Axe-Core A11y Audit Harness" {
        node (Join-Path $RootDir "ci\e2e\a11y_axe.js")
    }
}

# -----------------------------------------------------------------------------
# 4. CI GATEKEEPER QUALITY FLOOR SELF-CHECK
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "verify") {
    Write-Host "-- TIER 4: CI GATEKEEPER QUALITY FLOOR SELF-CHECK ------" -ForegroundColor Yellow

    Run-Step "Gatekeeper: Verify 100% Test Files Run & Floors Met" {
        & $VenvPython (Join-Path $RootDir "ci\verify_all_tests_run.py")
    }
}

Write-Banner "ALL CI/CD PIPELINE STAGES PASSED SUCCESSFULLY"
exit 0
