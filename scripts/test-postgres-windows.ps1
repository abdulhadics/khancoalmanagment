#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PostgresBin,
    [ValidateRange(1024, 65535)]
    [int]$Port = 55437
)

$ErrorActionPreference = 'Stop'
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('khancoal-ci-' + [guid]::NewGuid().ToString('N'))
New-Item -Path $testDirectory -ItemType Directory | Out-Null

if (!$PostgresBin) {
    $archive = Join-Path $testDirectory 'postgresql.zip'
    $approvedHash = '520C8C6F19ABB3B31FA83EC5E486E2F769EEDD7593D94E60A7CDA8A5BFB4DF91'
    $source = 'https://get.enterprisedb.com/postgresql/postgresql-17.12-2-windows-x64-binaries.zip'

    & curl.exe --fail --silent --show-error --location --retry 3 --output $archive $source
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $approvedHash) {
        throw 'Unable to verify the pinned PostgreSQL test archive.'
    }

    & tar.exe -xf $archive -C $testDirectory pgsql/bin pgsql/lib pgsql/share
    if ($LASTEXITCODE -ne 0) { throw 'Unable to unpack the PostgreSQL test binaries.' }
    $PostgresBin = Join-Path $testDirectory 'pgsql/bin'
}

$initializer = Join-Path $PostgresBin 'initdb.exe'
$controller = Join-Path $PostgresBin 'pg_ctl.exe'
$dataDirectory = Join-Path $testDirectory 'data'
$logPath = Join-Path $testDirectory 'postgres.log'
$passwordFile = Join-Path $testDirectory 'bootstrap-password'
$passwordBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$testPassword = ([BitConverter]::ToString($passwordBytes)).Replace('-', '').ToLowerInvariant()
[System.IO.File]::WriteAllText($passwordFile, $testPassword)

try {
    & $initializer -D $dataDirectory --username=postgres --pwfile=$passwordFile --encoding=UTF8 --locale=C --auth=scram-sha-256
    if ($LASTEXITCODE -ne 0) { throw 'Unable to initialize the isolated PostgreSQL cluster.' }
} finally {
    Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue
}

$priorUrl = $env:TEST_ADMIN_DATABASE_URL
$started = $false
try {
    & $controller start -D $dataDirectory -l $logPath -o "-h 127.0.0.1 -p $Port" -w
    if ($LASTEXITCODE -ne 0) { throw 'Unable to start the isolated PostgreSQL cluster.' }
    $started = $true
    $env:TEST_ADMIN_DATABASE_URL = "postgresql://postgres:${testPassword}@127.0.0.1:$Port/postgres"
    & npm.cmd run test:integration
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL integration checks failed.' }
} finally {
    $env:TEST_ADMIN_DATABASE_URL = $priorUrl
    if ($started) {
        & $controller stop -D $dataDirectory -m fast -w
        if ($LASTEXITCODE -ne 0) { throw 'Unable to stop the isolated PostgreSQL cluster.' }
    }
}
