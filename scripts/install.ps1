#requires -Version 5.1
<#
.SYNOPSIS
    Personakit one-line installer (PowerShell / Windows).

.DESCRIPTION
    Downloads a GitHub source archive over HTTP, extracts it into
    .\.personakit-plugin\, builds the MCP server, and registers
    .vscode\mcp.json. No `git` dependency.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex

.NOTES
    Env vars (all optional):
      PERSONAKIT_DIR          Target dir for the install. Default: .\.personakit-plugin
      PERSONAKIT_REF          Branch / tag / SHA. Default: main
      PERSONAKIT_ARCHIVE_URL  Direct override for the archive URL (used by tests
                              and for self-hosted mirrors). When unset, the URL
                              is derived as
                              https://codeload.github.com/microsoftnorman/personakit/zip/<ref>.
      PERSONAKIT_NO_VSCODE    Set to "1" to skip writing .vscode\mcp.json.
#>

$ErrorActionPreference = 'Stop'

$RepoOwner = 'microsoftnorman'
$RepoName  = 'personakit'
$TargetDir = if ($env:PERSONAKIT_DIR) { $env:PERSONAKIT_DIR } else { '.\.personakit-plugin' }
$Ref       = if ($env:PERSONAKIT_REF) { $env:PERSONAKIT_REF } else { 'main' }

$DefaultArchiveUrl = "https://codeload.github.com/$RepoOwner/$RepoName/zip/$Ref"
$ArchiveUrl = if ($env:PERSONAKIT_ARCHIVE_URL) {
    $env:PERSONAKIT_ARCHIVE_URL
} else {
    $DefaultArchiveUrl
}

# ─── Source shared lib ──────────────────────────────────────────────────────
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { '' }
if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'lib\common.ps1'))) {
    . (Join-Path $ScriptDir 'lib\common.ps1')
} else {
    $commonUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$Ref/scripts/lib/common.ps1"
    try {
        $commonContent = (Invoke-WebRequest -UseBasicParsing -Uri $commonUrl).Content
    } catch {
        Write-Host "  ✗ Could not fetch shared lib from $commonUrl" -ForegroundColor Red
        exit 1
    }
    Invoke-Expression $commonContent
}

# ─── Helpers (script-local) ────────────────────────────────────────────────
function Get-PkArchive {
    param([string]$Url, [string]$DestZip)
    if ($Url -like 'file://*') {
        # Convert "file:///d:/path/foo.zip" → "d:\path\foo.zip" so we can use
        # Copy-Item (Invoke-WebRequest's file:// support is inconsistent
        # across PowerShell editions).
        $local = $Url -replace '^file:///?', ''
        $local = [Uri]::UnescapeDataString($local) -replace '/', '\'
        Copy-Item -LiteralPath $local -Destination $DestZip -Force
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $DestZip
    }
}

function Test-PkLooksLikeInstall {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    return (Test-Path (Join-Path $Path '.personakit-version')) -or
           (Test-Path (Join-Path $Path 'packages\personakit-mcp\package.json'))
}

# ─── Main ───────────────────────────────────────────────────────────────────
Write-PkBold 'Personakit installer'
Write-Host ''
Write-PkInfo "Detected package manager: $(Get-PkPkgManager)"
Write-Host ''

# ─── Dependency check (no git required) ────────────────────────────────────
Write-PkBold 'Checking dependencies'
if (-not (Test-PkAllDeps)) {
    Write-Host ''
    Write-PkErr 'Dependency check failed. Install the missing tools above and re-run.'
    exit 1
}
Write-Host ''

# ─── Download + extract ─────────────────────────────────────────────────────
Write-PkBold 'Fetching source'
$workTmp    = Join-Path ([System.IO.Path]::GetTempPath()) ("personakit-" + [guid]::NewGuid().ToString('N'))
$zipPath    = Join-Path $workTmp 'archive.zip'
$extractDir = Join-Path $workTmp 'extract'
New-Item -ItemType Directory -Path $workTmp, $extractDir -Force | Out-Null
try {
    Write-PkInfo "Downloading $ArchiveUrl"
    Get-PkArchive -Url $ArchiveUrl -DestZip $zipPath
    Write-PkOk "Downloaded $([math]::Round((Get-Item $zipPath).Length / 1KB)) KB"

    Write-PkInfo 'Extracting…'
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $extracted = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $extracted) {
        Write-PkErr 'Archive did not contain a top-level folder.'
        exit 1
    }

    $parentDir = Split-Path $TargetDir -Parent
    if ($parentDir -and -not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    $absTarget = if ([System.IO.Path]::IsPathRooted($TargetDir)) {
        $TargetDir
    } else {
        Join-Path (Get-Location).Path $TargetDir
    }

    if (Test-Path $absTarget) {
        if (-not (Test-PkLooksLikeInstall $absTarget)) {
            Write-PkErr "Refusing to overwrite $absTarget — it doesn't look like a previous Personakit install."
            Write-PkDim 'Move or delete it manually, or set $env:PERSONAKIT_DIR to a different path.'
            exit 1
        }
        Write-PkInfo "Replacing existing install at $absTarget"
        Remove-Item -Recurse -Force $absTarget
    }
    Move-Item -LiteralPath $extracted.FullName -Destination $absTarget

    # Stamp a small version file so update/doctor know what's installed.
    $stamp = [pscustomobject]@{
        ref         = $Ref
        archive_url = $ArchiveUrl
        installed   = (Get-Date).ToString('o')
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath (Join-Path $absTarget '.personakit-version') -Value $stamp -Encoding UTF8

    Write-PkOk "Installed to $absTarget"
} finally {
    if (Test-Path $workTmp) { Remove-Item -Recurse -Force $workTmp }
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
        "GITHUB_MODELS_TOKEN": "`${env:GITHUB_MODELS_TOKEN}",
        "GH_TOKEN": "`${env:GH_TOKEN}",
        "GITHUB_TOKEN": "`${env:GITHUB_TOKEN}"
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

# ─── LLM access check (informational) ──────────────────────────────────────
Write-PkBold 'LLM access'
Test-PkLlmCredential
Write-Host ''

# ─── Done ──────────────────────────────────────────────────────────────────
Write-PkBold 'Done.'
Write-Host ''
Write-Host '  Next steps:'
Write-Host '    1. Reload your editor (VS Code Insiders + Copilot Chat recommended).'
Write-Host '       No token setup required — Personakit uses MCP host sampling.'
Write-Host ''
Write-Host '    2. In Copilot Chat, try:'
Write-Host '         "Generate 5 synthetic personas for <your product brief>."'
Write-Host '       (VS Code will prompt you to allow the first sampling call.)'
Write-Host ''
Write-Host '    Optional: only set GITHUB_MODELS_TOKEN / GH_TOKEN / GITHUB_TOKEN'
Write-Host '    when running outside a sampling-capable host (e.g. Copilot CLI).'
Write-Host ''
Write-Host "  Plugin location:    $TargetDir"
Write-Host "  Skills + agents:    $TargetDir\plugins\personakit\"
Write-Host "  Reference example:  $TargetDir\examples\saas-project-management-tool\"
Write-Host ''
Write-Host '  To update later:'
Write-Host '    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex'
Write-Host ''
Write-Host '  To run a health check:'
Write-Host '    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.ps1 | iex'
Write-Host ''
