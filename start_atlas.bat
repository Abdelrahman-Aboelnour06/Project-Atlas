@echo off
title Project Atlas v3.0 - AI Web Assistant
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -NoExit -File "%~dp0start_atlas.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Atlas launcher encountered an issue. See output above.
    pause
)
