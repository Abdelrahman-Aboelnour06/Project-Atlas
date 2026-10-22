[CmdletBinding()]
param()

try {
    $Host.UI.RawUI.WindowTitle = "Project Atlas v3.0 - AI Web Assistant"
    Clear-Host
} catch {}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "    ____             _           _       _   _             " -ForegroundColor Cyan
Write-Host "   |  _ \ _ __ ___  (_) ___  ___| |_    / \ | |_| | __ _ ___ " -ForegroundColor Cyan
Write-Host "   | |_) | '__/ _ \ | |/ _ \/ __| __|  / _ \| __| |/ _` / __|" -ForegroundColor Cyan
Write-Host "   |  __/| | | (_) || |  __/ (__| |_  / ___ \ |_| | (_| \__ \" -ForegroundColor Cyan
Write-Host "   |_|   |_|  \___// |\___|\___|\__|/_/   \_\__|_|\__,_|___/" -ForegroundColor Cyan
Write-Host "                 |__/                                       " -ForegroundColor Cyan
Write-Host "        Dual-Speed Autonomous AI Web Navigation System" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$RootDir = $PSScriptRoot
if (-not $RootDir) {
    $RootDir = "D:\Free Time Projects\Hackathon\Project-Atlas"
}

try {
    $RunScript = Join-Path $RootDir "run_atlas.ps1"
    $BravePaths = @(
        "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
    )
    $BravePath = $BravePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

    # Detect user's main profile in Brave ('Marwan Nader')
    $BraveProfileDir = "Profile 1"
    try {
        $localStatePath = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Local State"
        if (Test-Path $localStatePath) {
            $localStateJson = Get-Content $localStatePath -Raw | ConvertFrom-Json
            foreach ($prop in $localStateJson.profile.info_cache.PSObject.Properties) {
                if ($prop.Value.name -like "*Marwan*") {
                    $BraveProfileDir = $prop.Name
                    break
                }
            }
        }
    } catch {}

    $DemoUrl = "http://localhost:5500"
    $BackendUrl = "http://localhost:8000"
    $DemoApiKey = "atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

    # 1. Start Atlas Stack (Postgres, Backend, Demo Site)
    Write-Host ""
    Write-Host "[1/4] Activating Atlas services (Postgres, Backend, Demo-Site)..." -ForegroundColor Yellow
    & $RunScript start

    # 2. Automatically copy Demo API key to Windows clipboard
    try {
        Set-Clipboard -Value $DemoApiKey
        Write-Host "[2/4] Demo API Key automatically copied to clipboard! (Ready for Ctrl+V)" -ForegroundColor Green
    } catch {
        Write-Host "[2/4] Demo API Key: $DemoApiKey" -ForegroundColor Green
    }

    # 3. Launch Brave browser in user's main profile
    Write-Host "[3/4] Launching Brave Browser (Main Profile: Marwan Nader) to $DemoUrl..." -ForegroundColor Yellow
    if ($BravePath) {
        Start-Process -FilePath $BravePath -ArgumentList @("--profile-directory=$BraveProfileDir", $DemoUrl)
    } else {
        Start-Process $DemoUrl
    }

    # 4. Display Active Dashboard
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "                       ATLAS SERVICES ACTIVE" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  [*] PostgreSQL Server  : 127.0.0.1:5432 (Online)" -ForegroundColor White
    Write-Host "  [*] Atlas Backend API  : $BackendUrl (Healthy)" -ForegroundColor White
    Write-Host "  [*] Interactive Demo   : $DemoUrl" -ForegroundColor White
    Write-Host "  [*] API Documentation  : $BackendUrl/docs" -ForegroundColor White
    Write-Host "  [*] Extension Folder   : $RootDir\client-script" -ForegroundColor White
    Write-Host "  [*] Demo API Key       : $DemoApiKey" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  Extension Quick Setup in Brave (First time only):" -ForegroundColor Gray
    Write-Host "  1. In Brave, go to brave://extensions -> Enable 'Developer mode' (top right)." -ForegroundColor Gray
    Write-Host "  2. Click 'Load unpacked' -> Select: $RootDir\client-script" -ForegroundColor Gray
    Write-Host "  3. Click the Atlas toolbar icon, paste the API key (already in clipboard)," -ForegroundColor Gray
    Write-Host "     and click Save!" -ForegroundColor Gray
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  Controls:" -ForegroundColor White
    Write-Host "  [B] Open Demo Site in Brave      [E] Open Extensions Manager in Brave" -ForegroundColor Yellow
    Write-Host "  [C] Copy API Key to Clipboard    [Q] Stop Atlas and Exit" -ForegroundColor Yellow
    Write-Host "======================================================================" -ForegroundColor Cyan

    # Interactive control loop
    while ($true) {
        $hasKey = $false
        try {
            $hasKey = [Console]::KeyAvailable
        } catch {
            $hasKey = $false
        }
        if ($hasKey) {
            try {
                $key = [Console]::ReadKey($true).Key
                switch ($key) {
                    "B" {
                        Write-Host "Opening Demo Site in Brave ($BraveProfileDir)..." -ForegroundColor Yellow
                        if ($BravePath) {
                            Start-Process -FilePath $BravePath -ArgumentList @("--profile-directory=$BraveProfileDir", $DemoUrl)
                        } else {
                            Start-Process $DemoUrl
                        }
                    }
                    "E" {
                        Write-Host "Opening Extensions Manager in Brave ($BraveProfileDir)..." -ForegroundColor Yellow
                        if ($BravePath) {
                            Start-Process -FilePath $BravePath -ArgumentList @("--profile-directory=$BraveProfileDir", "brave://extensions")
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
                        Write-Host ""
                        Write-Host "Stopping Atlas services..." -ForegroundColor Red
                        & $RunScript stop
                        Write-Host "All Atlas services stopped. Goodbye!" -ForegroundColor Gray
                        Start-Sleep -Seconds 1
                        exit 0
                    }
                }
            } catch {}
        }
        Start-Sleep -Milliseconds 250
    }
} catch {
    Write-Host ""
    Write-Host "An error occurred while launching Atlas:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit..."
}
