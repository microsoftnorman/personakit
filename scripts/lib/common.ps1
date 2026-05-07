# Personakit shared dependency / environment helpers (PowerShell).
# Dot-sourced by install.ps1, update.ps1, and doctor.ps1.

function Write-PkBold($msg) { Write-Host $msg -ForegroundColor White }
function Write-PkInfo($msg) { Write-Host "  ▸ $msg" -ForegroundColor Cyan }
function Write-PkOk($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-PkWarn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-PkErr($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-PkDim($msg)  { Write-Host "    $msg"  -ForegroundColor DarkGray }

function Get-PkPkgManager {
    if (Get-Command winget -ErrorAction SilentlyContinue) { return 'winget' }
    if (Get-Command choco  -ErrorAction SilentlyContinue) { return 'choco'  }
    if (Get-Command scoop  -ErrorAction SilentlyContinue) { return 'scoop'  }
    return 'none'
}

function Get-PkInstallHint([string]$Tool) {
    $pm = Get-PkPkgManager
    switch -regex ("$Tool`:$pm") {
        '^git:winget$'   { return 'winget install --id Git.Git -e --source winget' }
        '^git:choco$'    { return 'choco install git -y' }
        '^git:scoop$'    { return 'scoop install git' }
        '^git:'          { return 'Install Git for Windows from https://git-scm.com/download/win' }

        '^node:winget$'  { return 'winget install --id OpenJS.NodeJS.LTS -e' }
        '^node:choco$'   { return 'choco install nodejs-lts -y' }
        '^node:scoop$'   { return 'scoop install nodejs-lts' }
        '^node:'         { return 'Install Node.js LTS from https://nodejs.org/ (or use nvm-windows: https://github.com/coreybutler/nvm-windows)' }

        '^npm:'          { return 'npm ships with Node.js — installing Node will install npm.' }

        default          { return "Install $Tool manually." }
    }
}

# Returns: $true if $A >= $B (semver-ish compare).
function Test-PkVersionGe([string]$A, [string]$B) {
    $aClean = ($A -replace '^v','') -replace '[^\d.].*$',''
    $bClean = ($B -replace '^v','') -replace '[^\d.].*$',''
    try {
        $aV = [version]$aClean
        $bV = [version]$bClean
        return ($aV -ge $bV)
    } catch {
        return $false
    }
}

# Check one dependency. Returns: $true if OK; $false if missing or too old.
function Test-PkDep {
    param(
        [Parameter(Mandatory=$true)] [string]$Cmd,
        [string]$Min = '',
        [string]$Flag = '-v'
    )
    if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
        Write-PkErr "$Cmd`: not found"
        Write-PkDim "Install: $(Get-PkInstallHint $Cmd)"
        return $false
    }
    if ($Min) {
        $raw = (& $Cmd $Flag 2>&1 | Select-Object -First 1)
        $verMatch = [regex]::Match($raw, '\d+\.\d+(\.\d+)?')
        if (-not $verMatch.Success) {
            Write-PkWarn "$Cmd`: present (version unknown)"
            return $true
        }
        $ver = $verMatch.Value
        if (Test-PkVersionGe $ver $Min) {
            Write-PkOk "$Cmd $ver"
            return $true
        }
        Write-PkErr "$Cmd $ver — need >= $Min"
        Write-PkDim "Upgrade: $(Get-PkInstallHint $Cmd)"
        return $false
    }
    Write-PkOk "$Cmd present"
    return $true
}

function Test-PkLlmCredential {
    # Personakit only works with GitHub Copilot. We accept GITHUB_MODELS_TOKEN
    # (preferred) or fall back to GH_TOKEN / GITHUB_TOKEN, both of which the
    # Copilot CLI sets for the active session.
    if ($env:GITHUB_MODELS_TOKEN) {
        Write-PkOk 'GitHub credential: GITHUB_MODELS_TOKEN'
    } elseif ($env:GH_TOKEN) {
        Write-PkOk 'GitHub credential: GH_TOKEN (Copilot CLI session)'
    } elseif ($env:GITHUB_TOKEN) {
        Write-PkOk 'GitHub credential: GITHUB_TOKEN'
    } else {
        Write-PkWarn 'No GitHub credential set (GITHUB_MODELS_TOKEN / GH_TOKEN / GITHUB_TOKEN)'
        Write-PkDim 'Personakit only works with GitHub Copilot. Set one of:'
        Write-PkDim '  $env:GITHUB_MODELS_TOKEN = "<your token>"   # preferred'
        Write-PkDim '  $env:GH_TOKEN            = "<your token>"   # Copilot CLI session token'
        Write-PkDim '  $env:GITHUB_TOKEN        = "<your token>"   # generic GitHub token'
    }
}

function Test-PkAllDeps {
    $ok = $true
    if (-not (Test-PkDep -Cmd git  -Flag '--version')) { $ok = $false }
    if (-not (Test-PkDep -Cmd node -Min '18.0.0' -Flag '-v')) { $ok = $false }
    if (-not (Test-PkDep -Cmd npm  -Flag '-v'))  { $ok = $false }
    return $ok
}
