<#
.SYNOPSIS
  run_atlas.ps1 - bring up the whole Atlas stack locally on Windows.

.DESCRIPTION
  What this script DOES automate:
    1. Postgres (via Docker Desktop, unless you already have one running)
    2. Backend venv + pip install
    3. Schema migration (001_init.sql) + demo API key seed
    4. Backend server (uvicorn) in a background job
    5. Demo site static server in a background job

  What it CANNOT automate (manual steps printed at the end):
    - Loading the unpacked Chrome extension (chrome://extensions is a GUI-only flow)
    - Getting/pasting an LLM_API_KEY from https://build.nvidia.com (or switching to Ollama)
    - Pasting the demo API key into the extension's options page

.USAGE
  .\run_atlas.ps1          # start everything
  .\run_atlas.ps1 stop     # stop backend + demo-site jobs started by this script

  Run this from the repo root (the folder containing backend\, client-script\, demo-site\).
  You may need: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#>

param(
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$RootDir     = $PSScriptRoot
$BackendDir  = Join-Path $RootDir "backend"
$DemoDir     = Join-Path $RootDir "demo-site"
$StateDir    = Join-Path $RootDir ".atlas-run"
$BackendPort = 8000
$DemoPort    = 5500
$PgContainer = "atlas-pg"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Log  ($msg) { Write-Host "[atlas] $msg" -ForegroundColor Cyan }
function Warn ($msg) { Write-Host "[atlas] $msg" -ForegroundColor Yellow }
function Err  ($msg) { Write-Host "[atlas] $msg" -ForegroundColor Red }

# -- stop mode -----------------------------------------------------------------
if ($Action -eq "stop") {
    foreach ($name in @("backend", "demo-site")) {
        $jobFile = Join-Path $StateDir "$name.jobid"
        if (Test-Path $jobFile) {
            $jobId = Get-Content $jobFile
            $job = Get-Job -Id $jobId -ErrorAction SilentlyContinue
            if ($job) {
                Stop-Job $job -ErrorAction SilentlyContinue
                Remove-Job $job -Force -ErrorAction SilentlyContinue
                Log "Stopped $name (job $jobId)"
            }
            Remove-Item $jobFile -Force
        }
    }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $running = docker ps --format "{{.Names}}" | Select-String -Pattern "^$PgContainer$"
        if ($running) {
            docker stop $PgContainer | Out-Null
            Log "Stopped Postgres container ($PgContainer)"
        }
    }
    Log "Everything stopped."
    exit 0
}

# -- sanity checks -------------------------------------------------------------
if (-not (Test-Path $BackendDir)) { Err "backend\ not found - run this from the repo root."; exit 1 }
if (-not (Test-Path $DemoDir))    { Err "demo-site\ not found - run this from the repo root."; exit 1 }

foreach ($cmd in @("python", "curl")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Err "$cmd is required but not found on PATH."
        exit 1
    }
}

# -- 1. Postgres ---------------------------------------------------------------
Log "Checking Postgres..."
$hasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)

if ($hasDocker) {
    $existingRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "^$PgContainer$"
    $existingAny      = docker ps -a --format "{{.Names}}" | Select-String -Pattern "^$PgContainer$"

    if ($existingRunning) {
        Log "Postgres container '$PgContainer' already running."
    } elseif ($existingAny) {
        Log "Starting existing Postgres container '$PgContainer'..."
        docker start $PgContainer | Out-Null
    } else {
        Log "Creating Postgres container '$PgContainer'..."
        docker run --name $PgContainer `
            -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=atlas -e POSTGRES_DB=atlas_db `
            -p 5432:5432 -d postgres:16 | Out-Null
    }

    Log "Waiting for Postgres to accept connections..."
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        docker exec $PgContainer pg_isready -U atlas *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Err "Postgres didn't come up in time. Check: docker logs $PgContainer"
        exit 1
    }
    Log "Postgres is ready."
} else {
    Warn "Docker not found. Assuming you already have Postgres running locally"
    Warn "with a database/user matching backend\.env's DATABASE_URL. Continuing..."
}

# -- 2. Backend venv + deps ----------------------------------------------------
Push-Location $BackendDir

$VenvDir = Join-Path $BackendDir "venv"
if (-not (Test-Path $VenvDir)) {
    Log "Creating Python venv..."
    python -m venv venv
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip    = Join-Path $VenvDir "Scripts\pip.exe"
$VenvUvicorn = Join-Path $VenvDir "Scripts\uvicorn.exe"

Log "Installing backend dependencies (this can take a minute)..."
& $VenvPython -m pip install -q --upgrade pip
& $VenvPython -m pip install -q -r requirements.txt

$EnvFile = Join-Path $BackendDir ".env"
if (-not (Test-Path $EnvFile)) {
    Log "No .env found - creating one from .env.example."
    Copy-Item ".env.example" ".env"
    Warn "backend\.env was just created from the template."
    Warn "You MUST edit it and set LLM_API_KEY (from https://build.nvidia.com),"
    Warn "or switch LLM_PROVIDER to 'ollama' if you're running a local model."
    Warn "Re-run this script after editing .env."
    Pop-Location
    exit 1
}

$envContent = Get-Content $EnvFile -Raw
$hasKey     = $envContent -match "(?m)^LLM_API_KEY=\S+"
$isOllama   = $envContent -match "(?m)^LLM_PROVIDER=ollama"
if (-not $hasKey -and -not $isOllama) {
    Err "backend\.env has no LLM_API_KEY set and LLM_PROVIDER is not 'ollama'."
    Err "The backend will refuse to start. Edit backend\.env, then re-run this script."
    Pop-Location
    exit 1
}

# -- 3. Migration + seed -------------------------------------------------------
$dbUrlLine = ($envContent -split "`n" | Where-Object { $_ -match "^DATABASE_URL=" }) | Select-Object -First 1
$dbUrl     = $dbUrlLine -replace "^DATABASE_URL=", ""
$dbUrl     = $dbUrl.Trim()

# postgresql+asyncpg://user:pass@host:port/db -> pull out pieces
if ($dbUrl -match "://([^:]+):[^@]+@([^:/]+)(?::\d+)?/([^/?]+)") {
    $dbUser = $Matches[1]
    $dbHost = $Matches[2]
    $dbName = $Matches[3]
} else {
    Err "Couldn't parse DATABASE_URL from .env: $dbUrl"
    Pop-Location
    exit 1
}

Log "Applying schema migration (001_init.sql)..."
if ($hasDocker -and (docker ps --format "{{.Names}}" | Select-String -Pattern "^$PgContainer$")) {
    Get-Content "app\migrations\001_init.sql" -Raw | docker exec -i $PgContainer psql -U $dbUser -d $dbName
} else {
    $env:PGPASSWORD = "atlas"
    psql -h $dbHost -U $dbUser -d $dbName -f "app\migrations\001_init.sql"
}

Log "Seeding demo tenant + API key..."
& $VenvPython -m app.migrations.seed

# -- 4. Start backend server ---------------------------------------------------
$backendListening = Test-NetConnection -ComputerName localhost -Port $BackendPort -WarningAction SilentlyContinue -InformationLevel Quiet
if ($backendListening) {
    Warn "Something is already listening on port $BackendPort - assuming backend is up."
} else {
    Log "Starting backend on http://localhost:$BackendPort ..."
    $job = Start-Job -ScriptBlock {
        param($uvicorn, $dir, $port)
        Set-Location $dir
        & $uvicorn app.main:app --port $port
    } -ArgumentList $VenvUvicorn, $BackendDir, $BackendPort
    $job.Id | Out-File (Join-Path $StateDir "backend.jobid")
    Start-Sleep -Seconds 2
}

Log "Health-checking backend..."
$healthy = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) {
    Err "Backend didn't come up. Check: Receive-Job -Id (Get-Content '$StateDir\backend.jobid')"
    Pop-Location
    exit 1
}
Log "Backend is healthy."
Pop-Location

# -- 5. Start demo-site server -------------------------------------------------
$demoListening = Test-NetConnection -ComputerName localhost -Port $DemoPort -WarningAction SilentlyContinue -InformationLevel Quiet
if ($demoListening) {
    Warn "Something is already listening on port $DemoPort - assuming demo-site is up."
} else {
    Log "Starting demo-site on http://localhost:$DemoPort ..."
    $job = Start-Job -ScriptBlock {
        param($dir, $port)
        Set-Location $dir
        python -m http.server $port
    } -ArgumentList $DemoDir, $DemoPort
    $job.Id | Out-File (Join-Path $StateDir "demo-site.jobid")
}

# -- done - print manual steps -------------------------------------------------
Write-Host ""
Write-Host "------------------------------------------------------------------"
Write-Host " Backend   -> http://localhost:$BackendPort  (docs at /docs)"
Write-Host " Demo site -> http://localhost:$DemoPort"
Write-Host "------------------------------------------------------------------"
Write-Host ""
Write-Host "Demo API key (already seeded): atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
Write-Host ""
Write-Host "Two things this script can't do for you - a few clicks in Chrome:"
Write-Host ""
Write-Host "  1. Load the extension"
Write-Host "     chrome://extensions -> enable 'Developer mode' (top right) ->"
Write-Host "     'Load unpacked' -> select: $RootDir\client-script"
Write-Host ""
Write-Host "  2. Activate + configure it"
Write-Host "     Open http://localhost:$DemoPort, click the Atlas toolbar icon."
Write-Host "     It'll open the options page automatically the first time -"
Write-Host "     paste in the demo key above, confirm backend URL is"
Write-Host "     http://localhost:$BackendPort, save, then click the icon again."
Write-Host ""
Write-Host "Optional - the tenant dashboard (mock data only, not required for the demo):"
Write-Host "     cd $RootDir\dashboard; npm install; npm run dev"
Write-Host "     -> http://localhost:3000"
Write-Host ""
Write-Host "To stop the backend + demo-site jobs (and the Postgres container):"
Write-Host "     .\run_atlas.ps1 stop"
Write-Host ""
Write-Host "View logs any time with:"
Write-Host "     Receive-Job -Id (Get-Content '$StateDir\backend.jobid') -Keep"
Write-Host "     Receive-Job -Id (Get-Content '$StateDir\demo-site.jobid') -Keep"
Write-Host "------------------------------------------------------------------"
