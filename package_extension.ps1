<#
.SYNOPSIS
    Project Atlas MV3 Extension Packaging Wrapper (Windows PowerShell)
.DESCRIPTION
    Validates and packages the Chrome MV3 extension into dist/project-atlas-extension.zip.
.PARAMETER VerifyOnly
    Runs verification checks only without writing the zip archive.
#>
[CmdletBinding()]
param(
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: Node.js is required but was not found in PATH."
    exit 1
}

$NodeArgs = @("$ScriptDir/client-script/package_extension.js")
if ($VerifyOnly) {
    $NodeArgs += "--verify-only"
}

& node @NodeArgs
exit $LASTEXITCODE
