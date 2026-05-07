#requires -Version 5.1
<#
.SYNOPSIS
    Personakit one-line installer (PowerShell / Windows).

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex

.NOTES
    Env vars (all optional):
      PERSONAKIT_DIR          Target dir for the clone. Default: .\.personakit-plugin
      PERSONAKIT_REF          Git ref to check out. Default: main
      PERSONAKIT_NO_VSCODE    Set to "1" to skip writing .vscode\mcp.json
#>

$ErrorActionPreference = 'Stop'

$RepoUrl   = 'https://github.com/microsoftnorman/personakit.git'
$TargetDir = if ($env:PERSONAKIT_DIR) { $env:PERSONAKIT_DIR } else { '.\.personakit-plugin' }
$GitRef    = if ($env:PERSONAKIT_REF) { $env:PERSONAKIT_REF } else { 'main' }

# ─── Source shared lib ──────────────────────────────────────────────────────
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { '' }
if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'lib\common.ps1'))) {
    . (Join-Path $ScriptDir 'lib\common.ps1')
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

Write-PkBold 'Personakit installer'
Write-Host ''
Write-PkInfo "Detected package manager: $(Get-PkPkgManager)"
Write-Host ''

# ─── Dependency check ───────────────────────────────────────────────────────
Write-PkBold 'Checking dependencies'
if (-not (Test-PkAllDeps)) {
    Write-Host ''
    Write-PkErr 'Dependency check failed. Install the missing tools above and re-run.'
    exit 1
}
Write-Host ''

# ─── Clone or update ────────────────────────────────────────────────────────
Write-PkBold 'Fetching source'
if (Test-Path (Join-Path $TargetDir '.git')) {
    Write-PkInfo "Updating existing clone at $TargetDir"
    git -C $TargetDir fetch --quiet origin $GitRef
    git -C $TargetDir checkout --quiet $GitRef
    git -C $TargetDir pull --ff-only --quiet origin $GitRef
    Write-PkOk "Updated to latest $GitRef"
} else {
    Write-PkInfo "Cloning $RepoUrl into $TargetDir"
    git clone --quiet --branch $GitRef --depth 1 $RepoUrl $TargetDir
    Write-PkOk 'Cloned'
}
Write-Host ''

# ─── Install + build ────────────────────────────────────────────────────────
Write-PkBold 'Installing & building'
Push-Location $TargetDir
try {
    Write-PkInfo 'npm install (this may take a minute)…'
    npm install --silent --no-audit --no-fund | Out-Null
    Write-PkOk 'Dependencies installed'

    Write-PkInfo 'Building personakit-mcp'
    npm run --silent build -w personakit-mcp | Out-Null
    Write-PkOk 'Built'
} finally {
    Pop-Location
}
Write-Host ''

# ─── Write .vscode/mcp.json ────────────────────────────────────────────────
Write-PkBold 'Editor configuration'
if ($env:PERSONAKIT_NO_VSCODE -eq '1') {
    Write-PkInfo 'Skipping .vscode\mcp.json (PERSONAKIT_NO_VSCODE=1)'
} else {
    if (-not (Test-Path '.vscode')) { New-Item -ItemType Directory -Path '.vscode' | Out-Null }

    $absMcp = (Resolve-Path (Join-Path $TargetDir 'packages/personakit-mcp/dist/index.js')).Path -replace '\\','/'
    $entry = @"
{
  "servers": {
    "personakit": {
      "type": "stdio",
      "command": "node",
      "args": ["$absMcp"],
      "env": {
        "PERSONAKIT_WORKSPACE_ROOT": "`${workspaceFolder}",
        "GITHUB_MODELS_TOKEN": "`${env:GITHUB_MODELS_TOKEN}"
      }
    }
  }
}
"@

    if (Test-Path '.vscode/mcp.json') {
        Write-PkWarn '.vscode\mcp.json already exists — leaving it alone.'
        Write-PkDim 'Merge this entry manually under "servers":'
        Write-Host ''
        Write-Host $entry
    } else {
        Set-Content -Path '.vscode/mcp.json' -Value $entry -Encoding UTF8
        Write-PkOk 'Wrote .vscode\mcp.json'
    }
}
Write-Host ''

# ─── LLM credential check (warn-only) ──────────────────────────────────────
Write-PkBold 'LLM credential'
Test-PkLlmCredential
Write-Host ''

# ─── Done ──────────────────────────────────────────────────────────────────
Write-PkBold 'Done.'
Write-Host ''
Write-Host '  Next steps:'
Write-Host '    1. Set an LLM credential if you haven''t yet:'
Write-Host '         $env:GITHUB_MODELS_TOKEN = "<your token>"'
Write-Host ''
Write-Host '    2. Reload your editor (VS Code Insiders + Copilot Chat recommended).'
Write-Host ''
Write-Host '    3. In Copilot Chat, try:'
Write-Host '         "Generate 5 synthetic personas for <your product brief>."'
Write-Host ''
Write-Host "  Plugin location:    $TargetDir"
Write-Host "  Skills + agents:    $TargetDir\plugins\personakit\"
Write-Host "  Reference example:  $TargetDir\examples\saas-project-management-tool\"
Write-Host ''
Write-Host '  To check for updates later:'
Write-Host '    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex'
Write-Host ''
Write-Host '  To run a health check:'
Write-Host '    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.ps1 | iex'
Write-Host ''
