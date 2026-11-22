#Requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'S4U')]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true, ParameterSetName = 'S4U')][string]$RunAsUser,
    [Parameter(Mandatory = $true, ParameterSetName = 'Password')][pscredential]$Credential,
    [string]$TaskName = 'KhanCoalSupplier Daily Backup',
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')][string]$LocalTime = '02:00'
)

$ErrorActionPreference = 'Stop'
$configItem = Get-Item -LiteralPath $ConfigPath
if ($configItem.PSIsContainer) { throw 'Pass the path to the protected backup JSON file.' }
$config = $configItem.FullName
$settings = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
if ($settings.objectMirror -and !$Credential) {
    throw 'Cloud backup requires the network-enabled -Credential task option.'
}
$script = (Get-Item -LiteralPath (Join-Path $PSScriptRoot 'backup.ps1')).FullName
$workingDirectory = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..')).FullName
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -File "{0}" -ConfigPath "{1}"' -f $script, $config

$schedule = @{
    TaskName = $TaskName
    Action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $workingDirectory
    Trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.Add([TimeSpan]::ParseExact($LocalTime, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture)))
    Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 70) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Description = 'Creates a daily encrypted KhanCoalSupplier database archive.'
    Force = $true
    ErrorAction = 'Stop'
}

if ($Credential) {
    $registered = Register-ScheduledTask @schedule -User $Credential.UserName -Password ($Credential.GetNetworkCredential().Password) -RunLevel Limited
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType S4U -RunLevel Limited
    $registered = Register-ScheduledTask @schedule -Principal $principal
}
if (!$registered) { throw 'Task Scheduler did not register the backup task. Check Windows task registration permissions.' }
Write-Output "Registered the daily backup task for $LocalTime in the server's local time."
