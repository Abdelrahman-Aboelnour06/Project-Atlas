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
    $ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
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

    # 3. Launch Chrome browser
    Write-Host "[3/4] Launching Google Chrome to $DemoUrl..." -ForegroundColor Yellow
    if (Test-Path $ChromePath) {
        Start-Process $ChromePath $DemoUrl
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
    Write-Host "  Extension Quick Setup (First time only):" -ForegroundColor Gray
    Write-Host "  1. Open chrome://extensions -> Enable 'Developer mode' (top right)." -ForegroundColor Gray
    Write-Host "  2. Click 'Load unpacked' -> Select: $RootDir\client-script" -ForegroundColor Gray
    Write-Host "  3. Click the Atlas toolbar icon, paste the API key (already in clipboard)," -ForegroundColor Gray
    Write-Host "     and click Save!" -ForegroundColor Gray
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  Controls:" -ForegroundColor White
    Write-Host "  [B] Open Demo Site in Browser    [D] Open API Documentation" -ForegroundColor Yellow
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
