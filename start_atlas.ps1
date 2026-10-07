<#
.SYNOPSIS
  start_atlas.ps1 - Desktop Launcher for Project Atlas Full Stack & Browser
#>
[CmdletBinding()]
param()

$Host.UI.RawUI.WindowTitle = "Project Atlas v3.0 — AI Web Assistant"
Clear-Host

Write-Host @"
======================================================================
     ____             _           _       _   _             
    |  _ \ _ __ ___  (_) ___  ___| |_    / \ | |_| | __ _ ___
    | |_) | '__/ _ \ | |/ _ \/ __| __|  / _ \| __| |/ _`` / __|
    |  __/| | | (_) || |  __/ (__| |_  / ___ \ |_| | (_| \__ \
    |_|   |_|  \___// |\___|\___|\__|/_/   \_\__|_|\__,_|___/
                  |__/                                       
         Dual-Speed Autonomous AI Web Navigation System
======================================================================
"@ -ForegroundColor Cyan

$RootDir = $PSScriptRoot
$RunScript = Join-Path $RootDir "run_atlas.ps1"
$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$DemoUrl = "http://localhost:5500"
$BackendUrl = "http://localhost:8000"
$DemoApiKey = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

# 1. Start Atlas Stack (Postgres, Backend, Demo Site)
Write-Host "`n[1/4] Activating Atlas services (Postgres, Backend, Demo-Site)..." -ForegroundColor Yellow
& $RunScript start

# 2. Automatically copy Demo API key to Windows clipboard
try {
    Set-Clipboard -Value $DemoApiKey
    Write-Host "[2/4] Demo API Key automatically copied to clipboard! (Ready for Ctrl+V)" -ForegroundColor Green
} catch {
    Write-Host "[2/4] Demo API Key: $DemoApiKey" -ForegroundColor Green
}

# 3. Launch Chrome browser
Write-Host "[3/4] Launching Google Chrome to $DemoUrl..." -ForegroundColor Yellow
if (Test-Path $ChromePath) {
    Start-Process $ChromePath $DemoUrl
} else {
    Start-Process $DemoUrl
}

# 4. Display Active Dashboard
Write-Host @"

======================================================================
                       ATLAS SERVICES ACTIVE
======================================================================
  [*] PostgreSQL Server  : 127.0.0.1:5432 (Online)
  [*] Atlas Backend API  : $BackendUrl (Healthy)
  [*] Interactive Demo   : $DemoUrl
  [*] API Documentation  : $BackendUrl/docs
  [*] Extension Directory: $RootDir\client-script
  [*] Demo API Key       : $DemoApiKey
======================================================================
  Extension Quick Setup (First time only):
  1. Open chrome://extensions -> Enable 'Developer mode' (top right).
  2. Click 'Load unpacked' -> Select: $RootDir\client-script
  3. Click the Atlas toolbar icon, paste the API key (already in clipboard),
     and click Save!
======================================================================
  Controls:
  [B] Open Demo Site in Browser    [D] Open API Documentation
  [C] Copy API Key to Clipboard    [Q] Stop Atlas and Exit
======================================================================
"@ -ForegroundColor Cyan

# Interactive control loop
while ($true) {
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true).Key
        switch ($key) {
            "B" {
                Write-Host "Opening Demo Site in browser..." -ForegroundColor Yellow
                if (Test-Path $ChromePath) {
                    Start-Process $ChromePath $DemoUrl
                } else {
                    Start-Process $DemoUrl
                }
            }
            "D" {
                Write-Host "Opening API Documentation..." -ForegroundColor Yellow
                Start-Process "$BackendUrl/docs"
            }
            "C" {
                try {
                    Set-Clipboard -Value $DemoApiKey
                    Write-Host "API Key copied to clipboard!" -ForegroundColor Green
                } catch {
                    Write-Host "Key: $DemoApiKey" -ForegroundColor Green
                }
            }
            "Q" {
                Write-Host "`nStopping Atlas services..." -ForegroundColor Red
                & $RunScript stop
                Write-Host "All Atlas services stopped. Goodbye!" -ForegroundColor Gray
                Start-Sleep -Seconds 1
                exit 0
            }
        }
    }
    Start-Sleep -Milliseconds 250
}
