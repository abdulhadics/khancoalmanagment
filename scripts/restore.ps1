#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$TargetDatabase,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$IdentityPath,
    [Parameter(Mandatory = $true)][string]$PrivateScratchDirectory
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
& $node (Join-Path $PSScriptRoot 'backup/restore.mjs') $ConfigPath $TargetDatabase $ArchivePath $ExpectedSha256 $IdentityPath $PrivateScratchDirectory
exit $LASTEXITCODE
