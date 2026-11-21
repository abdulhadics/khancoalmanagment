#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DeploymentDirectory,
    [Parameter(Mandatory)][string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$AppConfigFile,
    [Parameter(Mandatory)][string]$NssmPath,
    [Parameter(Mandatory)][string]$CaddyPath,
    [Parameter(Mandatory)][string]$PostgresBin,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$')][string]$SiteName,
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{1,48}$')][string]$AppService = 'KhanCoalSupplier',
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{1,48}$')][string]$ProxyService = 'KhanCoalCaddy',
    [ValidateSet('Domain', 'Private', 'Public')][string[]]$FirewallProfile = @('Domain', 'Private'),
    [switch]$LanOnly,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows/common.ps1')
if ($AppService -eq $ProxyService) { throw 'Use different application and proxy service names.' }
if (![System.IO.Path]::IsPathRooted($DeploymentDirectory) -or ![System.IO.Path]::IsPathRooted($ReleaseDirectory)) {
    throw 'Use absolute deployment and release directories.'
}
$deploymentRoot = [System.IO.Path]::GetFullPath($DeploymentDirectory)
$releaseRoot = [System.IO.Path]::GetFullPath($ReleaseDirectory)
$releasePrefix = (Join-Path $deploymentRoot 'releases').TrimEnd('\') + '\'
if (!$releaseRoot.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The release directory must be inside the deployment releases folder.'
}
if (!(Test-Path -LiteralPath (Join-Path $releaseRoot '.next/BUILD_ID') -PathType Leaf)) {
    throw 'Stage a production build with deploy.ps1 -StageOnly before installing the services.'
}
$configFile = Get-RequiredFile $AppConfigFile 'application configuration file'
$nssm = Get-RequiredFile $NssmPath 'NSSM executable'
$caddy = Get-RequiredFile $CaddyPath 'Caddy executable'
$node = Get-NativeCommand 'node.exe'
& (Join-Path $PSScriptRoot 'check-prerequisites.ps1') -RequirePostgres -PostgresBin $PostgresBin
$normalizeEnv = @'
const { parseEnv } = require('node:util')
const values = parseEnv(require('node:fs').readFileSync(process.argv[1], 'utf8'))
const port = Number(values.APP_PORT ?? 3000)
const valid = values.DEPLOYMENT_ENV === 'production' && values.APP_ORIGIN === process.argv[2] && port === Number(process.argv[3])
const required = ['DATABASE_URL', 'AUTH_ENCRYPTION_KEY', 'SMTP_FROM', 'SMTP_URL']
if (!valid || required.some(key => !values[key])) process.exit(1)
'@
Invoke-Checked $node @('-e', $normalizeEnv, $configFile, "https://$SiteName", "$Port") 'Check the production app configuration, HTTPS origin, and loopback port'
Invoke-Checked $nssm @('version') 'NSSM did not start'

$tls = if ($LanOnly) { '    tls internal' } else { '' }
$caddyfile = @"
{
    admin off
    skip_install_trust
}

$SiteName {
$tls
    reverse_proxy 127.0.0.1:$Port {
        header_up X-KC-Client-IP {remote_host}
    }
}
"@

$validationFile = [System.IO.Path]::GetTempFileName()
try {
    [System.IO.File]::WriteAllText($validationFile, $caddyfile)
    Invoke-Checked $caddy @('fmt', '--overwrite', $validationFile) 'Unable to format the Caddy configuration'
    Invoke-Checked $caddy @('adapt', '--config', $validationFile, '--adapter', 'caddyfile', '--validate') 'Caddy configuration failed validation' | Out-Null
    $caddyfile = [System.IO.File]::ReadAllText($validationFile)
} finally {
    Remove-Item -LiteralPath $validationFile
}
if ($ValidateOnly) {
    Write-Host 'Production config, existing release, and Caddy syntax validated.'
    return
}

Assert-Elevated
$lock = Open-DeploymentLock $deploymentRoot
try {
    $logs = Join-Path $deploymentRoot 'logs'
    $caddyState = Join-Path $deploymentRoot 'caddy'
    $caddyConfiguration = Join-Path $deploymentRoot 'proxy-config'
    $appLogs = Join-Path $logs 'app'
    $proxyLogs = Join-Path $logs 'proxy'
    foreach ($folder in @($logs, $caddyState, $caddyConfiguration, $appLogs, $proxyLogs)) {
        [System.IO.Directory]::CreateDirectory($folder) | Out-Null
    }
    $proxyConfig = Join-Path $caddyConfiguration 'Caddyfile'
    $currentProxy = Get-Service -Name $ProxyService -ErrorAction SilentlyContinue
    if ($currentProxy -and $currentProxy.Status -ne 'Stopped') {
        if (!(Test-Path -LiteralPath $proxyConfig -PathType Leaf) -or [System.IO.File]::ReadAllText($proxyConfig) -cne $caddyfile) {
            throw 'The running proxy has a different Caddy configuration. Review the change during a maintenance window.'
        }
    } else {
        [System.IO.File]::WriteAllText($proxyConfig, $caddyfile)
    }
    $serviceController = Join-Path $env:SystemRoot 'System32/sc.exe'

    function Set-KhanCoalService($Name, $Program, $WorkingDirectory, $Parameters, $Environment, $LogDirectory) {
        $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($service) {
            Invoke-Checked $nssm @('get', $Name, 'Application') "Service $Name is not managed by NSSM" | Out-Null
            if ($service.Status -ne 'Stopped') {
                $configuredProgram = [string](Invoke-Checked $nssm @('get', $Name, 'Application') "Unable to check $Name executable")
                $configuredDirectory = [string](Invoke-Checked $nssm @('get', $Name, 'AppDirectory') "Unable to check $Name directory")
                $configuredParameters = [string](Invoke-Checked $nssm @('get', $Name, 'AppParameters') "Unable to check $Name parameters")
                $configuredEnvironment = @(Invoke-Checked $nssm @('get', $Name, 'AppEnvironmentExtra') "Unable to check $Name configuration")
                if ($configuredProgram -ine $Program -or $configuredDirectory -ine $WorkingDirectory -or $configuredParameters -cne $Parameters -or
                    $configuredEnvironment.Count -ne @($Environment).Count -or (Compare-Object $Environment $configuredEnvironment)) {
                    throw "Service $Name uses a different installation. Use deploy.ps1 for app releases and schedule other changes."
                }
                return
            }
        } else {
            Invoke-Checked $nssm @('install', $Name, $Program) "Unable to install service $Name"
        }
        Set-Service -Name $Name -StartupType Disabled
        Invoke-Checked $serviceController @('config', $Name, 'obj=', "NT SERVICE\$Name") "Unable to set the service identity for $Name"
        $serviceSettings = [ordered]@{
            Application = $Program; AppDirectory = $WorkingDirectory; AppParameters = $Parameters
            AppEnvironmentExtra = $Environment
            AppStdout = (Join-Path $LogDirectory 'output.log'); AppStderr = (Join-Path $LogDirectory 'error.log')
            AppRotateFiles = '1'; AppRotateOnline = '1'; AppRotateBytes = '10485760'
            AppRestartDelay = '3000'
        }
        foreach ($setting in $serviceSettings.GetEnumerator()) {
            Invoke-Checked $nssm (@('set', $Name, $setting.Key) + $setting.Value) "Unable to configure $Name $($setting.Key)"
        }
        Invoke-Checked $nssm @('set', $Name, 'AppExit', 'Default', 'Restart') "Unable to configure recovery for $Name"
    }

    Set-KhanCoalService $AppService $node $releaseRoot '--import tsx scripts/serve.ts start' @("KHANCOAL_CONFIG_FILE=$configFile", 'NEXT_TELEMETRY_DISABLED=1') $appLogs
    Set-KhanCoalService $ProxyService $caddy $caddyConfiguration 'run --adapter caddyfile --config Caddyfile' @("XDG_DATA_HOME=$caddyState", "XDG_CONFIG_HOME=$caddyState") $proxyLogs

    $icacls = Join-Path $env:SystemRoot 'System32/icacls.exe'
    Invoke-Checked $icacls @((Join-Path $deploymentRoot 'releases'), '/grant', "NT SERVICE\${AppService}:(OI)(CI)RX") 'Unable to grant release access'
    Invoke-Checked $icacls @($configFile, '/grant', "NT SERVICE\${AppService}:R") 'Unable to grant application config access'
    Invoke-Checked $icacls @($appLogs, '/grant', "NT SERVICE\${AppService}:(OI)(CI)M") 'Unable to grant application log access'
    Invoke-Checked $icacls @($caddyConfiguration, '/grant', "NT SERVICE\${ProxyService}:(OI)(CI)RX") 'Unable to grant Caddy configuration access'
    Invoke-Checked $icacls @($caddyState, '/grant', "NT SERVICE\${ProxyService}:(OI)(CI)M") 'Unable to grant Caddy state access'
    Invoke-Checked $icacls @($proxyLogs, '/grant', "NT SERVICE\${ProxyService}:(OI)(CI)M") 'Unable to grant proxy log access'

    if ((Get-Service -Name $AppService).Status -ne 'Running') {
        Set-Service -Name $AppService -StartupType Manual
        Start-Service -Name $AppService
    }
    Wait-AppProbe $Port
    Set-Service -Name $AppService -StartupType Automatic
    $firewall = @{
        Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'
        LocalPort = @('80', '443'); Program = $caddy
        Profile = $FirewallProfile
        RemoteAddress = if ($LanOnly) { 'LocalSubnet' } else { 'Any' }
    }
    $rule = "KhanCoal-$ProxyService"
    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -Name $rule @firewall | Out-Null
    } else {
        New-NetFirewallRule -Name $rule -DisplayName 'KhanCoalSupplier HTTPS and redirect' @firewall | Out-Null
    }
    if ((Get-Service -Name $ProxyService).Status -ne 'Running') {
        Set-Service -Name $ProxyService -StartupType Manual
        Start-Service -Name $ProxyService
    }
    $curl = Get-NativeCommand 'curl.exe'
    $caPath = Join-Path $caddyState 'caddy/pki/authorities/local/root.crt'
    $curlArguments = @('--fail', '--silent', '--max-time', '4', '--noproxy', '*', '--resolve', "${SiteName}:443:127.0.0.1")
    if ($LanOnly) { $curlArguments += @('--cacert', $caPath) }
    $proxyReady = $false
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        & $curl @curlArguments "https://$SiteName/readyz" | Out-Null
        if ($LASTEXITCODE -eq 0) { $proxyReady = $true; break }
        Start-Sleep -Seconds 2
    }
    if (!$proxyReady) { throw 'Caddy did not pass the HTTPS readiness probe. Check its log, DNS, and firewall.' }
    Set-Service -Name $ProxyService -StartupType Automatic
    Write-Host "Installed and started the KhanCoalSupplier services. Open https://$SiteName from an authorized device."
} finally {
    $lock.Dispose()
}
