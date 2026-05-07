#requires -Version 5.1
<#
.SYNOPSIS
    Personakit updater (PowerShell / Windows).

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex

.NOTES
    Env vars:
      PERSONAKIT_DIR     Default: .\.personakit-plugin
      PERSONAKIT_REF     Default: main
      PERSONAKIT_FORCE   Set to "1" to rebuild even when already up-to-date.
#>

$ErrorActionPreference = 'Stop'

$TargetDir = if ($env:PERSONAKIT_DIR) { $env:PERSONAKIT_DIR } else { '.\.personakit-plugin' }
$GitRef    = if ($env:PERSONAKIT_REF) { $env:PERSONAKIT_REF } else { 'main' }

# ─── Source shared lib ──────────────────────────────────────────────────────
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { '' }
$LocalLib  = Join-Path $TargetDir 'scripts\lib\common.ps1'
if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'lib\common.ps1'))) {
    . (Join-Path $ScriptDir 'lib\common.ps1')
} elseif (Test-Path $LocalLib) {
    . $LocalLib
} else {
    $commonUrl = "https://raw.githubusercontent.com/microsoftnorman/personakit/$GitRef/scripts/lib/common.ps1"
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

if (-not (Test-Path (Join-Path $TargetDir '.git'))) {
    Write-PkErr "No Personakit clone found at $TargetDir."
    Write-PkDim 'Run the installer first:'
    Write-PkDim '  iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex'
    exit 1
}
Write-PkOk "Found clone: $TargetDir"

# ─── Quick dep check ───────────────────────────────────────────────────────
Write-PkInfo 'Verifying dependencies'
if (-not (Test-PkAllDeps)) {
    Write-PkErr 'Dependency check failed. Resolve the above and re-run.'
    exit 1
}
Write-Host ''

# ─── Compare local vs remote ───────────────────────────────────────────────
Write-PkBold 'Checking for updates'
git -C $TargetDir fetch --quiet origin $GitRef
$local  = (git -C $TargetDir rev-parse HEAD).Trim()
$remote = (git -C $TargetDir rev-parse "origin/$GitRef").Trim()
$shortLocal  = $local.Substring(0,7)
$shortRemote = $remote.Substring(0,7)

if ($local -eq $remote) {
    Write-PkOk "Already up-to-date ($shortLocal on $GitRef)."
    if ($env:PERSONAKIT_FORCE -ne '1') {
        Write-Host ''
        Write-PkDim 'Set $env:PERSONAKIT_FORCE = "1" to rebuild anyway.'
        exit 0
    }
    Write-PkInfo 'PERSONAKIT_FORCE=1 — rebuilding anyway.'
} else {
    $commitsBehind = (git -C $TargetDir rev-list --count "$local..$remote").Trim()
    Write-PkInfo "Local:  $shortLocal"
    Write-PkInfo "Remote: $shortRemote ($commitsBehind commit(s) ahead)"
    Write-PkInfo 'Recent changes:'
    git -C $TargetDir log --oneline --no-decorate -n 10 "$local..$remote" | ForEach-Object { Write-Host "    $_" }
    Write-Host ''

    Write-PkInfo 'Pulling…'
    git -C $TargetDir checkout --quiet $GitRef
    git -C $TargetDir pull --ff-only --quiet origin $GitRef
    Write-PkOk "Updated to $shortRemote"
}
Write-Host ''

# ─── Reinstall + rebuild ───────────────────────────────────────────────────
Write-PkBold 'Reinstalling & rebuilding'
Push-Location $TargetDir
try {
    Write-PkInfo 'npm install'
    npm install --silent --no-audit --no-fund | Out-Null
    Write-PkOk 'Dependencies installed'

    Write-PkInfo 'Building personakit-mcp'
    npm run --silent build -w personakit-mcp | Out-Null
    Write-PkOk 'Built'
} finally {
    Pop-Location
}
Write-Host ''

Write-PkBold 'Done.'
Write-PkDim 'Reload your editor to pick up the new MCP server build.'
Write-Host ''
