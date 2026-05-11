#requires -Version 5.1
<#
.SYNOPSIS
    Personakit updater (PowerShell / Windows).

.DESCRIPTION
    Re-downloads the source archive over HTTP and reinstalls into the existing
    install directory. No `git` dependency. Refuses to touch the directory if
    it does not look like a previous Personakit install.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex

.NOTES
    Env vars:
      PERSONAKIT_DIR          Default: .\.personakit-plugin
      PERSONAKIT_REF          Default: main
      PERSONAKIT_ARCHIVE_URL  Override the archive URL
      PERSONAKIT_FORCE        Set to "1" to reinstall even if .personakit-version
                              already records the requested ref.
#>

$ErrorActionPreference = 'Stop'

$TargetDir = if ($env:PERSONAKIT_DIR) { $env:PERSONAKIT_DIR } else { '.\.personakit-plugin' }
$Ref       = if ($env:PERSONAKIT_REF) { $env:PERSONAKIT_REF } else { 'main' }

# ─── Source shared lib ──────────────────────────────────────────────────────
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { '' }
$LocalLib  = Join-Path $TargetDir 'scripts\lib\common.ps1'
if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'lib\common.ps1'))) {
    . (Join-Path $ScriptDir 'lib\common.ps1')
} elseif (Test-Path $LocalLib) {
    . $LocalLib
} else {
    $commonUrl = "https://raw.githubusercontent.com/microsoftnorman/personakit/$Ref/scripts/lib/common.ps1"
    try {
        $commonContent = (Invoke-WebRequest -UseBasicParsing -Uri $commonUrl).Content
    } catch {
        Write-Host "  ✗ Could not fetch shared lib from $commonUrl" -ForegroundColor Red
        exit 1
    }
    Invoke-Expression $commonContent
}

Write-PkBold 'Personakit updater'
Write-Host ''

# ─── Locate existing install ───────────────────────────────────────────────
$verFile = Join-Path $TargetDir '.personakit-version'
$mcpPkg  = Join-Path $TargetDir 'packages\personakit-mcp\package.json'
if (-not (Test-Path $verFile) -and -not (Test-Path $mcpPkg)) {
    Write-PkErr "No Personakit install found at $TargetDir."
    Write-PkDim 'Run the installer first:'
    Write-PkDim '  iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex'
    exit 1
}
Write-PkOk "Found install: $TargetDir"

if (Test-Path $verFile) {
    try {
        $current = Get-Content -LiteralPath $verFile -Raw | ConvertFrom-Json
        Write-PkDim "Current ref: $($current.ref) (installed $($current.installed))"
        if ($current.ref -eq $Ref -and $env:PERSONAKIT_FORCE -ne '1') {
            Write-PkOk "Already on '$Ref'."
            Write-Host ''
            Write-PkDim 'Set $env:PERSONAKIT_FORCE = "1" to re-download and rebuild anyway.'
            exit 0
        }
    } catch {
        Write-PkWarn '.personakit-version present but unreadable — re-installing.'
    }
}
Write-Host ''

# ─── Re-run installer (it handles dep check, download, build, mcp.json) ────
$installer = Join-Path $TargetDir 'scripts\install.ps1'
if (-not (Test-Path $installer)) {
    Write-PkErr "Installer script missing inside install dir: $installer"
    Write-PkDim 'Reinstall from scratch:'
    Write-PkDim '  iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex'
    exit 1
}

Write-PkInfo "Re-installing $TargetDir from ref '$Ref'…"
& $installer
exit $LASTEXITCODE
