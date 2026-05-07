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

function Write-Bold($msg) { Write-Host $msg -ForegroundColor White }
function Write-Info($msg) { Write-Host "  ▸ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg)       { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Bold 'Personakit installer'
Write-Host ''

# ─── Prereq checks ──────────────────────────────────────────────────────────
foreach ($cmd in 'git', 'node', 'npm') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Fail "$cmd is required but not found in PATH."
    }
}

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) {
    Fail "Node.js 18+ required (have $(node -v))."
}
$nodeVer = node -v
$gitVer  = (git --version).Split(' ')[2]
Write-Ok "Prerequisites OK (node $nodeVer, git $gitVer)"

# ─── Clone or update ────────────────────────────────────────────────────────
if (Test-Path (Join-Path $TargetDir '.git')) {
    Write-Info "Updating existing clone at $TargetDir"
    git -C $TargetDir fetch --quiet origin $GitRef
    git -C $TargetDir checkout --quiet $GitRef
    git -C $TargetDir pull --ff-only --quiet origin $GitRef
    Write-Ok "Updated to latest $GitRef"
} else {
    Write-Info "Cloning $RepoUrl into $TargetDir"
    git clone --quiet --branch $GitRef --depth 1 $RepoUrl $TargetDir
    Write-Ok 'Cloned'
}

# ─── Install + build ────────────────────────────────────────────────────────
Push-Location $TargetDir
try {
    Write-Info 'Installing dependencies (this may take a minute)…'
    npm install --silent --no-audit --no-fund | Out-Null
    Write-Ok 'Dependencies installed'

    Write-Info 'Building personakit-mcp'
    npm run --silent build -w personakit-mcp | Out-Null
    Write-Ok 'Built'
} finally {
    Pop-Location
}

# ─── Write .vscode/mcp.json ────────────────────────────────────────────────
if ($env:PERSONAKIT_NO_VSCODE -ne '1') {
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
        Write-Warn2 '.vscode/mcp.json already exists — leaving it alone.'
        Write-Warn2 'Merge this entry manually under "servers":'
        Write-Host ''
        Write-Host $entry
    } else {
        Set-Content -Path '.vscode/mcp.json' -Value $entry -Encoding UTF8
        Write-Ok 'Wrote .vscode/mcp.json'
    }
}

Write-Host ''
Write-Bold 'Done.'
Write-Host ''
Write-Host '  Next steps:'
Write-Host '    1. Set an LLM credential. Personakit auto-detects, in order:'
Write-Host '         GITHUB_MODELS_TOKEN  (recommended for Copilot users)'
Write-Host '         OPENAI_API_KEY'
Write-Host '         ANTHROPIC_API_KEY'
Write-Host ''
Write-Host '       Example: $env:GITHUB_MODELS_TOKEN = "<your token>"'
Write-Host ''
Write-Host '    2. Reload your editor (VS Code Insiders + Copilot Chat recommended).'
Write-Host ''
Write-Host '    3. In Copilot Chat, try:'
Write-Host '         "Generate 5 synthetic personas for <your product brief>."'
Write-Host ''
Write-Host "  Plugin location: $TargetDir"
Write-Host "  Skills + agents: $TargetDir\plugins\personakit\"
Write-Host "  Reference example: $TargetDir\examples\saas-project-management-tool\"
Write-Host ''
