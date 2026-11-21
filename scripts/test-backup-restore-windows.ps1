#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PostgresBin,
    [Parameter(Mandatory = $true)][string]$AgeBin,
    [ValidateRange(1024, 65535)][int]$Port = 55464
)

$ErrorActionPreference = 'Stop'
$PostgresBin = (Get-Item -LiteralPath $PostgresBin).FullName
$AgeBin = (Get-Item -LiteralPath $AgeBin).FullName
$temporaryRoot = (Get-Item -LiteralPath ([System.IO.Path]::GetTempPath().TrimEnd('\'))).FullName
$cluster = Join-Path $temporaryRoot ('khancoal-backup-test-pg-' + [guid]::NewGuid().ToString('N'))
$dataDirectory = Join-Path $cluster 'data'
$passwordPath = Join-Path $cluster 'test-password'
$controller = Join-Path $PostgresBin 'pg_ctl.exe'
$priorUrl = $env:TEST_ADMIN_DATABASE_URL
$password = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$started = $false
$result = 1

New-Item -Path $cluster -ItemType Directory | Out-Null
Push-Location (Join-Path $PSScriptRoot '..')
try {
    [System.IO.File]::WriteAllText($passwordPath, $password)
    & (Join-Path $PostgresBin 'initdb.exe') -D $dataDirectory --username postgres --encoding UTF8 --locale C --auth scram-sha-256 --pwfile $passwordPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the isolated backup test cluster.' }
    Remove-Item -LiteralPath $passwordPath

    & $controller start -D $dataDirectory -l (Join-Path $cluster 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated backup test cluster.' }
    $started = $true

    $env:TEST_ADMIN_DATABASE_URL = "postgresql://postgres:${password}@127.0.0.1:${Port}/postgres"
    & node.exe --import tsx (Join-Path $PSScriptRoot 'backup/test-roundtrip.mjs') $PostgresBin $AgeBin
    $result = $LASTEXITCODE
} finally {
    $env:TEST_ADMIN_DATABASE_URL = $priorUrl
    if ($started) {
        & $controller stop -D $dataDirectory -m fast -w
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the isolated backup test cluster.' }
    }
    Pop-Location
    $resolved = Get-Item -LiteralPath $cluster
    if ($resolved.Parent.FullName -eq $temporaryRoot -and $resolved.Name -match '^khancoal-backup-test-pg-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved.FullName -Recurse -Force
    }
}
exit $result
