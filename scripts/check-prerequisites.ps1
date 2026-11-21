#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$RequirePostgres,
    [string]$PostgresBin
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Run this prerequisite check from Windows PowerShell or PowerShell on Windows.'
}

$nodeExecutable = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$npmExecutable = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeExecutable -or -not $npmExecutable) {
    throw 'Install Node.js LTS with npm, reopen PowerShell, and try again.'
}

$nodeRelease = & $nodeExecutable.Source -p 'JSON.stringify({ version: process.versions.node, lts: Boolean(process.release.lts) })' | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $nodeRelease.lts) {
    throw 'Install Node.js 22 LTS (22.18 or newer) or Node.js 24 LTS.'
}
$nodeVersion = [version]$nodeRelease.version
if ($nodeVersion.Major -ne 24 -and ($nodeVersion.Major -ne 22 -or $nodeVersion -lt [version]'22.18.0')) {
    throw 'Install Node.js 22 LTS (22.18 or newer) or Node.js 24 LTS.'
}

$npmVersion = & $npmExecutable.Source --version
if ($LASTEXITCODE -ne 0) {
    throw 'npm failed to run. Repair the Node.js installation.'
}
Write-Host "Node.js $($nodeRelease.version) LTS and npm $npmVersion are available."

if (-not $RequirePostgres -and -not $PostgresBin) {
    return
}

foreach ($clientTool in @('psql.exe', 'pg_dump.exe', 'pg_restore.exe')) {
    if ($PostgresBin) {
        $clientPath = Join-Path -Path $PostgresBin -ChildPath $clientTool
    }
    else {
        $clientPath = (Get-Command $clientTool -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    }
    if (-not $clientPath -or -not (Test-Path -LiteralPath $clientPath -PathType Leaf)) {
        throw "Missing $clientTool. Install PostgreSQL client tools and add their bin folder to PATH, or pass -PostgresBin."
    }

    & $clientPath --version
    if ($LASTEXITCODE -ne 0) {
        throw "$clientTool failed to run. Check the PostgreSQL client installation."
    }
}
