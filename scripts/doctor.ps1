#requires -Version 5.1
<#
.SYNOPSIS
    Personakit health check (PowerShell / Windows) — read-only.

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.ps1 | iex

.NOTES
    Reports on:
      - Dependencies (git, node 18+, npm)
      - GitHub Copilot credentials
      - Plugin clone state (path, branch, current vs latest commit)
      - Build output (dist/index.js present)
      - .vscode/mcp.json presence
      - .personakit/ sandbox stats

    Env vars:
      PERSONAKIT_DIR     Default: .\.personakit-plugin
      PERSONAKIT_REF     Default: main
      PERSONAKIT_SANDBOX Default: .\.personakit
#>

$ErrorActionPreference = 'Continue'

$TargetDir  = if ($env:PERSONAKIT_DIR) { $env:PERSONAKIT_DIR } else { '.\.personakit-plugin' }
$GitRef     = if ($env:PERSONAKIT_REF) { $env:PERSONAKIT_REF } else { 'main' }
$SandboxDir = if ($env:PERSONAKIT_SANDBOX) { $env:PERSONAKIT_SANDBOX } else { '.\.personakit' }

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

$Issues = 0

Write-PkBold 'Personakit doctor'
Write-Host ''
Write-PkInfo "Package manager: $(Get-PkPkgManager)"
Write-Host ''

# ─── 1. Dependencies ───────────────────────────────────────────────────────
Write-PkBold '1. Dependencies'
if (-not (Test-PkAllDeps)) { $Issues++ }
Write-Host ''

# ─── 2. LLM access ─────────────────────────────────────────────────────────
Write-PkBold '2. LLM access (MCP sampling preferred; env tokens are optional fallback)'
Test-PkLlmCredential
Write-Host ''

# ─── 3. Clone state ────────────────────────────────────────────────────────
Write-PkBold '3. Plugin clone state'
if (-not (Test-Path (Join-Path $TargetDir '.git'))) {
    Write-PkErr "No clone at $TargetDir"
    Write-PkDim 'Install with: iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex'
    $Issues++
} else {
    $branch = (git -C $TargetDir rev-parse --abbrev-ref HEAD).Trim()
    $local  = (git -C $TargetDir rev-parse HEAD).Trim()
    Write-PkOk "Clone: $TargetDir"
    Write-PkDim "Branch: $branch @ $($local.Substring(0,7))"

    try {
        git -C $TargetDir fetch --quiet origin $GitRef 2>$null
        $remote = (git -C $TargetDir rev-parse "origin/$GitRef").Trim()
        if ($local -eq $remote) {
            Write-PkOk "Up-to-date with origin/$GitRef"
        } else {
            $behind = (git -C $TargetDir rev-list --count "$local..$remote").Trim()
            Write-PkWarn "$behind commit(s) behind origin/$GitRef ($($remote.Substring(0,7)))"
            Write-PkDim 'Update with: iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex'
        }
    } catch {
        Write-PkWarn 'Could not contact origin (offline?). Skipping remote compare.'
    }
}
Write-Host ''

# ─── 4. Build output ───────────────────────────────────────────────────────
Write-PkBold '4. MCP server build'
$Dist = Join-Path $TargetDir 'packages\personakit-mcp\dist\index.js'
if (Test-Path $Dist) {
    Write-PkOk "Build present: $Dist"
} else {
    Write-PkErr "Build output missing: $Dist"
    Write-PkDim "Build with: cd $TargetDir; npm install; npm run build -w personakit-mcp"
    $Issues++
}
Write-Host ''

# ─── 5. Editor configuration ───────────────────────────────────────────────
Write-PkBold '5. Editor configuration'
if (Test-Path '.vscode\mcp.json') {
    $content = Get-Content '.vscode\mcp.json' -Raw
    if ($content -match '"personakit"') {
        Write-PkOk '.vscode\mcp.json registers personakit'
    } else {
        Write-PkWarn '.vscode\mcp.json exists but does not mention personakit'
        Write-PkDim 'Re-run install to add the entry, or merge it manually.'
    }
} else {
    Write-PkWarn '.vscode\mcp.json not found'
    Write-PkDim 'Re-run install or write it manually (snippet in install output).'
}
Write-Host ''

# ─── 6. Sandbox stats ──────────────────────────────────────────────────────
Write-PkBold '6. .personakit\ sandbox'
if (Test-Path $SandboxDir) {
    Write-PkOk "Sandbox: $SandboxDir"
    function Count-Files($sub, $pattern) {
        $p = Join-Path $SandboxDir $sub
        if (Test-Path $p) {
            return (Get-ChildItem -Path $p -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue).Count
        }
        return 0
    }
    $researchCount = if (Test-Path (Join-Path $SandboxDir 'research')) {
        (Get-ChildItem -Path (Join-Path $SandboxDir 'research') -Recurse -File -ErrorAction SilentlyContinue).Count
    } else { 0 }

    Write-PkDim "personas:    $(Count-Files 'personas' '*.json')"
    Write-PkDim "agents:      $(Count-Files 'agents' '*.agent.md')"
    Write-PkDim "research:    $researchCount"
    Write-PkDim "transcripts: $(Count-Files 'transcripts' '*.md')"
    Write-PkDim "gtm plans:   $(Count-Files 'gtm' '*-gtm.json')"
    Write-PkDim "audit days:  $(Count-Files 'audit' '*.jsonl')"
} else {
    Write-PkDim '(none yet — created on first MCP call)'
}
Write-Host ''

# ─── Summary ───────────────────────────────────────────────────────────────
if ($Issues -eq 0) {
    Write-PkBold 'All checks passed.'
    exit 0
} else {
    Write-PkBold "$Issues issue(s) above."
    exit 1
}
