#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DeploymentDirectory,
    [string]$SourceDirectory,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,127}$')][string]$Revision = 'HEAD',
    [string]$NssmPath,
    [string]$AppConfigFile,
    [string]$MigrationConfigFile,
    [string]$BackupConfigFile,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{1,48}$')][string]$AppService = 'KhanCoalSupplier',
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [switch]$StageOnly,
    [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows/common.ps1')
if (!$SourceDirectory) { $SourceDirectory = Split-Path -Parent $PSScriptRoot }
$source = (Get-Item -LiteralPath $SourceDirectory).FullName
$git = Get-NativeCommand 'git.exe'
$tar = Get-NativeCommand 'tar.exe'
$npm = Get-NativeCommand 'npm.cmd'
$node = Get-NativeCommand 'node.exe'
& (Join-Path $PSScriptRoot 'check-prerequisites.ps1')
if (!$StageOnly) {
    Assert-Elevated
    $nssm = Get-RequiredFile $NssmPath 'NSSM executable'
    $appConfig = Get-RequiredFile $AppConfigFile 'application configuration file'
    $migrationConfig = Get-RequiredFile $MigrationConfigFile 'migration configuration file'
    $backupConfig = Get-RequiredFile $BackupConfigFile 'backup configuration file'
    if ($env:DATABASE_URL -or $env:MIGRATION_DATABASE_URL) {
        throw 'Clear database URLs from this PowerShell session so the named deployment files supply the credentials.'
    }
    $compare = @'
const fs = require('node:fs')
const { parseEnv } = require('node:util')
try {
  const [applicationPath, migrationPath, backupPath, port] = process.argv.slice(1)
  const app = parseEnv(fs.readFileSync(applicationPath, 'utf8'))
  const migration = parseEnv(fs.readFileSync(migrationPath, 'utf8'))
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  const key = (text) => {
    const url = new URL(text)
    const host = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ? 'local' : url.hostname
    return [host, Number(url.port || 5432), decodeURIComponent(url.pathname.slice(1))].join('/')
  }
  const target = ['local', backup.port, backup.database].join('/')
  if (app.DEPLOYMENT_ENV !== 'production' || Number(app.APP_PORT || 3000) !== Number(port) ||
      key(app.DATABASE_URL) !== target || key(migration.MIGRATION_DATABASE_URL) !== target) process.exit(1)
} catch {
  process.exit(1)
}
'@
    Invoke-Checked $node @('-e', $compare, $appConfig, $migrationConfig, $backupConfig, "$Port") 'Application, migration, and backup configuration must use the same local database and application port'
    Get-Service -Name $AppService | Out-Null
    $activeEnvironment = @(Invoke-Checked $nssm @('get', $AppService, 'AppEnvironmentExtra') 'Unable to read the application service configuration')
    $activeFiles = @($activeEnvironment | Where-Object { $_ -match '^KHANCOAL_CONFIG_FILE=' })
    if ($activeFiles.Count -ne 1 -or $activeFiles[0].Substring('KHANCOAL_CONFIG_FILE='.Length) -ine $appConfig) {
        throw 'Use the same application configuration file recorded in the existing Windows service.'
    }
}

$lock = Open-DeploymentLock $DeploymentDirectory
try {
    if (!$SkipPull) {
        Invoke-Checked $git @('-C', $source, 'pull', '--ff-only') 'Git could not fast-forward the deployment checkout'
    }
    $commit = (Invoke-Checked $git @('-C', $source, 'rev-parse', '--verify', "$Revision^{commit}") 'Git revision could not be resolved' | Out-String).Trim()
    if ($commit -notmatch '^[a-f0-9]{40,64}$') { throw 'Git did not return a complete commit ID.' }
    $releases = Join-Path $DeploymentDirectory 'releases'
    $release = Join-Path $releases $commit
    $buildId = Join-Path $release '.next/BUILD_ID'
    $ready = Join-Path $release '.kc-release-ready'
    if (!(Test-Path -LiteralPath $ready -PathType Leaf) -or !(Test-Path -LiteralPath $buildId -PathType Leaf)) {
        [System.IO.Directory]::CreateDirectory($release) | Out-Null
        $archive = Join-Path $DeploymentDirectory "$commit.tar"
        try {
            Invoke-Checked $git @('-C', $source, 'archive', '--format=tar', "--output=$archive", $commit) 'Git could not export the selected revision'
            Invoke-Checked $tar @('-xf', $archive, '-C', $release) 'Unable to unpack the release'
        } finally {
            if (Test-Path -LiteralPath $archive -PathType Leaf) { Remove-Item -LiteralPath $archive }
        }
        Push-Location -LiteralPath $release
        try {
            Invoke-Checked $npm @('ci', '--include=dev') 'Dependency installation failed'
            Invoke-Checked $npm @('run', 'check') 'Release checks failed'
            if (!(Test-Path -LiteralPath $buildId -PathType Leaf)) { throw 'The new build has no Next.js build ID.' }
            [System.IO.File]::WriteAllText($ready, $commit)
        } finally {
            Pop-Location
        }
    }
    if ($StageOnly) {
        Write-Host "Staged release $commit."
        Write-Output $release
        return
    }

    $prior = (Invoke-Checked $nssm @('get', $AppService, 'AppDirectory') 'Unable to identify the active release' | Out-String).Trim()
    if (![System.IO.Path]::IsPathRooted($prior) -or !(Test-Path -LiteralPath (Join-Path $prior '.next/BUILD_ID') -PathType Leaf)) {
        throw 'The current service directory is missing a runnable release. Repair it before updating.'
    }
    if ($prior -eq $release -and (Test-AppProbe $Port)) {
        Write-Host "Release $commit is already active and healthy."
        return
    }

    try {
        Stop-Service -Name $AppService
        & (Join-Path $PSScriptRoot 'backup.ps1') -ConfigPath $backupConfig
        if ($LASTEXITCODE -ne 0) { throw 'The encrypted pre-deployment backup did not complete.' }

        Push-Location -LiteralPath $release
        try {
            Invoke-Checked $node @("--env-file=$migrationConfig", 'node_modules/prisma/build/index.js', 'migrate', 'deploy') 'Database migration failed'
        } finally {
            Pop-Location
        }
        Invoke-Checked $nssm @('set', $AppService, 'AppDirectory', $release) 'Unable to activate the new release'
        Start-Service -Name $AppService
        Wait-AppProbe $Port
        Write-Host "Activated release $commit. Health and readiness passed."
    } catch {
        $failure = $_
        Write-Warning 'Activation failed. Switching the application service to its prior release.'
        try {
            Stop-Service -Name $AppService -ErrorAction SilentlyContinue
            Invoke-Checked $nssm @('set', $AppService, 'AppDirectory', $prior) 'Unable to select the previous release'
            Start-Service -Name $AppService
            Wait-AppProbe $Port
        } catch {
            throw 'Deployment failed and the prior release could not pass probes. Use the incident steps in docs/RUNBOOK.md.'
        }
        throw $failure
    }
} finally {
    $lock.Dispose()
}
