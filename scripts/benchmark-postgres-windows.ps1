#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [ValidateRange(1000, 500000)]
    [int]$OrderCount = 100000,
    [ValidateRange(100, 10000)]
    [int]$PaymentCount = 10000,
    [ValidateRange(1024, 65535)]
    [int]$DatabasePort = 55450,
    [ValidateRange(1024, 65535)]
    [int]$AppPort = 3167,
    [ValidateRange(1, 30)]
    [int]$Rounds = 10,
    [string]$ScratchRoot = [System.IO.Path]::GetTempPath(),
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
if ($AppPort -eq $DatabasePort) { throw 'Use separate application and PostgreSQL ports.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$PostgresBin = (Resolve-Path -LiteralPath $PostgresBin).ProviderPath
if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.next/BUILD_ID'))) {
    throw 'Run npm.cmd run build before benchmarking.'
}

$scratch = (Resolve-Path -LiteralPath $ScratchRoot).ProviderPath
$scratchPrefix = $scratch.TrimEnd([char[]]"\/") + [IO.Path]::DirectorySeparatorChar
$clusterName = 'khancoal-benchmark-' + [guid]::NewGuid().ToString('N')
$clusterRoot = (New-Item -Path (Join-Path $scratch $clusterName) -ItemType Directory).FullName
$data = Join-Path $clusterRoot 'data'
$initializer = Join-Path $PostgresBin 'initdb.exe'
$controller = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$passwordPath = Join-Path $clusterRoot 'bootstrap-password'
$passwordBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$password = ([BitConverter]::ToString($passwordBytes)).Replace('-', '').ToLowerInvariant()
$started = $false
$environmentKeys = @('PGPASSWORD', 'DATABASE_URL', 'MIGRATION_DATABASE_URL',
    'DEPLOYMENT_ENV', 'NEXT_TELEMETRY_DISABLED', 'BENCHMARK_REPORT_PATH')
$priorEnvironment = @{}
foreach ($key in $environmentKeys) {
    $priorEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}

function Assert-CommandSucceeded([string]$operation) {
    if ($LASTEXITCODE -ne 0) { throw "$operation failed with exit code $LASTEXITCODE." }
}

Push-Location $projectRoot
try {
    if ($ReportPath) { $env:BENCHMARK_REPORT_PATH = [IO.Path]::GetFullPath($ReportPath) }
    else { Remove-Item Env:BENCHMARK_REPORT_PATH -ErrorAction SilentlyContinue }

    [IO.File]::WriteAllText($passwordPath, $password)
    try {
        & $initializer -D $data --username=postgres --pwfile=$passwordPath --encoding=UTF8 --locale=C --auth=scram-sha-256 | Out-Null
        Assert-CommandSucceeded 'PostgreSQL initialization'
    } finally {
        Remove-Item -LiteralPath $passwordPath -ErrorAction SilentlyContinue
    }
    $logPath = Join-Path $clusterRoot 'postgres.log'
    & $controller start -D $data -l $logPath -o "-h 127.0.0.1 -p $DatabasePort" -w
    Assert-CommandSucceeded 'PostgreSQL start'
    $started = $true
    $env:PGPASSWORD = $password
    $connection = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$DatabasePort, '-U', 'postgres', '--set=ON_ERROR_STOP=1')
    $name = 'khancoal_benchmark_test'
    & $psql @connection -d postgres -c "CREATE DATABASE $name TEMPLATE template0"
    Assert-CommandSucceeded 'Benchmark database creation'
    $env:DATABASE_URL = "postgresql://postgres:${password}@127.0.0.1:$DatabasePort/$name"
    $env:MIGRATION_DATABASE_URL = $env:DATABASE_URL
    $env:DEPLOYMENT_ENV = 'development'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    & npm.cmd run db:migrate
    Assert-CommandSucceeded 'Benchmark migration'

    $fixtureClock = [Diagnostics.Stopwatch]::StartNew()
    & $psql @connection -d $name --set=order_count=$OrderCount --set=payment_count=$PaymentCount -f (Join-Path $PSScriptRoot 'benchmark/fixture.sql')
    Assert-CommandSucceeded 'Benchmark fixture load'
    $fixtureClock.Stop()
    & node --import tsx scripts/benchmark/measure.ts $AppPort $Rounds ([int]$fixtureClock.Elapsed.TotalMilliseconds)
    Assert-CommandSucceeded 'Benchmark measurement'
} finally {
    Pop-Location
    foreach ($key in $environmentKeys) {
        [Environment]::SetEnvironmentVariable($key, $priorEnvironment[$key], 'Process')
    }
    $stopped = !$started
    if ($started) {
        & $controller stop -D $data -m fast -w
        $stopped = $LASTEXITCODE -eq 0
    }
    if (!$stopped) { throw 'PostgreSQL did not stop. The isolated benchmark data was retained.' }
    $resolvedCluster = (Resolve-Path -LiteralPath $clusterRoot).ProviderPath
    if (!$resolvedCluster.StartsWith($scratchPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedCluster) -ne $clusterName) {
        throw 'The resolved benchmark directory did not match its newly allocated path.'
    }
    Remove-Item -LiteralPath $resolvedCluster -Recurse -Force
}
