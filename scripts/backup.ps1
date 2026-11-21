#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath = $env:KHANCOAL_BACKUP_CONFIG,
    [string]$ActorId,
    [string]$RequestId,
    [string]$IpAddress
)

$ErrorActionPreference = 'Stop'
if (!$ConfigPath) { throw 'Set KHANCOAL_BACKUP_CONFIG or pass -ConfigPath.' }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$arguments = @((Join-Path $PSScriptRoot 'backup/create.mjs'), '--config', $ConfigPath)
if ($ActorId) { $arguments += @('--actor-id', $ActorId) }
if ($RequestId) { $arguments += @('--request-id', $RequestId) }
if ($IpAddress) { $arguments += @('--ip-address', $IpAddress) }

& $node @arguments
exit $LASTEXITCODE
