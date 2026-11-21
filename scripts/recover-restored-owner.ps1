#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TargetDatabase,
    [Parameter(Mandatory = $true)][string]$Username
)

$ErrorActionPreference = 'Stop'
if (!$env:DATABASE_URL) { throw 'Set DATABASE_URL to the verified recovery database first.' }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$password = Read-Host 'Enter a temporary Owner password' -AsSecureString
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle) | & $node --import tsx (Join-Path $PSScriptRoot 'recover-restored-owner.ts') $TargetDatabase $Username
    exit $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
    $password.Dispose()
}
