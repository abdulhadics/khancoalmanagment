#Requires -Version 5.1

function Get-RequiredFile([string]$Path, [string]$Label) {
    if (!$Path -or ![System.IO.Path]::IsPathRooted($Path) -or !(Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Provide an absolute path to the existing $Label."
    }
    return (Get-Item -LiteralPath $Path).FullName
}

function Get-NativeCommand([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$command) { throw "Install $Name and reopen Windows PowerShell." }
    return $command.Source
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Failure) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Failure (exit $LASTEXITCODE)." }
}

function Assert-Elevated {
    $principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Open Windows PowerShell as Administrator for Windows Service and firewall changes.'
    }
}

function Open-DeploymentLock([string]$Root) {
    if (![System.IO.Path]::IsPathRooted($Root)) { throw 'Use an absolute deployment directory.' }
    [System.IO.Directory]::CreateDirectory($Root) | Out-Null
    try {
        return [System.IO.File]::Open((Join-Path $Root '.deployment.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [System.IO.IOException] {
        throw 'Another KhanCoalSupplier installation or deployment is using this directory.'
    }
}

function Test-AppProbe([int]$Port) {
    foreach ($healthPath in @('healthz', 'readyz')) {
        try {
            $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/$healthPath" -UseBasicParsing -TimeoutSec 2
            if ($probe.StatusCode -ne 200) { return $false }
        } catch {
            return $false
        }
    }
    return $true
}

function Wait-AppProbe([int]$Port) {
    for ($attempt = 0; $attempt -lt 15; $attempt += 1) {
        if (Test-AppProbe $Port) { return }
        Start-Sleep -Seconds 2
    }
    throw "The application on port $Port did not pass health and readiness checks."
}
