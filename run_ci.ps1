<#
.SYNOPSIS
  run_ci.ps1 - Atlas CI/CD Pipeline Local Runner
  Executes Unit, Module, and System tests locally to ensure code remains stable.

.USAGE
  .\run_ci.ps1               # Runs all tiers (Security, Unit, Module, System)
  .\run_ci.ps1 -Stage security # Runs only Security tests
  .\run_ci.ps1 -Stage unit   # Runs only Unit tests
  .\run_ci.ps1 -Stage module # Runs only Module tests
  .\run_ci.ps1 -Stage system # Runs only System tests
#>

param(
    [ValidateSet("all", "security", "unit", "module", "system")]
    [string]$Stage = "all"
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$ClientScriptDir = Join-Path $RootDir "client-script"
$DashboardDir = Join-Path $RootDir "dashboard"

$VenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    $VenvPython = "python"
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

    # Git tracked .env check
    Run-Step "Security: Ensure No .env Files Tracked in Git" {
        $trackedEnv = git ls-files | Select-String -Pattern '(\.env$|\.env\.)'
        if ($trackedEnv) {
            throw "Security Gate Failure: Tracked .env files detected in repository: $trackedEnv"
        }
        Write-Host "    [OK] No .env secrets files tracked in repository" -ForegroundColor Green
    }

    # Extension security quality gates (no hardcoded keys, no eval, XSS escaping)
    Run-Step "Security: Extension Security Quality Gates and AST Audit" {
        node (Join-Path $ClientScriptDir "test_extension.js")
    }

    # Security and resilience automated regression tests
    Run-Step "Security: Automated Security and Resilience Regression Tests" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_security_resilience.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # Universal authentication gates and transaction rollback integrity tests
    Run-Step "Security and Transactions: Universal Auth Gates and DB Transaction Integrity" {
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
    Write-Host "-- TIER 1: UNIT TESTS ----------------------------------" -ForegroundColor Magenta

    # Extension code syntax and manifest validation
    Run-Step "Unit: Extension Script Syntax and Manifest Integrity" {
        node (Join-Path $ClientScriptDir "test_extension.js")
    }

    # Pydantic data models
    Run-Step "Unit: Backend Data Models (DomNode, AgentMessage, ActionResponse)" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_models.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # Action parser & prompt building
    Run-Step "Unit: Action and Simplify Parsers (LLM response extraction and sanitization)" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_action_parser.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # Rate limiter unit logic
    Run-Step "Unit: Rate Limiter (sliding window and tenant isolation)" {
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
    Write-Host "-- TIER 2: MODULE TESTS --------------------------------" -ForegroundColor Magenta

    # Database connection & hashing utilities
    Run-Step "Module: DB Utilities and Key Hashing" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_db_utils.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # REST routes module (/health, /v1/session/start, /v1/audit/log)
    Run-Step "Module: REST API Endpoints and Auth Handshake" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_routes_rest.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # Dashboard module compilation (if dependencies are present)
    if (Test-Path (Join-Path $DashboardDir "node_modules")) {
        Run-Step "Module: Dashboard Next.js Type Check and Compilation" {
            Push-Location $DashboardDir
            try {
                npm run build
            } finally {
                Pop-Location
            }
        }
    } else {
        Write-Host "--- [SKIPPED] Dashboard Next.js build (run 'npm install' in dashboard/ to enable)" -ForegroundColor DarkGray
    }
}

# -----------------------------------------------------------------------------
# 3. SYSTEM TESTING TIER
# -----------------------------------------------------------------------------
if ($Stage -eq "all" -or $Stage -eq "system") {
    Write-Host "-- TIER 3: SYSTEM TESTS --------------------------------" -ForegroundColor Magenta

    # WebSocket agent integration pipeline
    Run-Step "System: WebSocket Agent Pipeline (Handshake, Simplify, Command, RateLimit)" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_websocket.py -v --tb=short
        } finally {
            Pop-Location
        }
    }

    # Complete multi-service End-to-End System flow
    Run-Step "System: Complete Multi-Service End-to-End Workflow" {
        Push-Location $BackendDir
        try {
            & $VenvPython -m pytest tests/test_system_e2e.py -v --tb=short
        } finally {
            Pop-Location
        }
    }
}

Write-Banner "ALL CI/CD PIPELINE STAGES PASSED SUCCESSFULLY"
exit 0
