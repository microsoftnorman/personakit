<#
.SYNOPSIS
    Pester tests for scripts/install.ps1.

.DESCRIPTION
    End-to-end test of the installer that runs fully offline:
      1. Creates a bare git clone of the working tree in $TestDrive\repo.git.
      2. Points the installer at it via PERSONAKIT_REPO_URL.
      3. Runs the installer into a sandbox workspace and asserts:
         - dependency check passed (script exited 0),
         - the plugin was cloned and built (dist/index.js exists),
         - .vscode/mcp.json was written with the expected shape,
         - re-running is idempotent (update path),
         - PERSONAKIT_NO_VSCODE=1 skips the .vscode write,
         - an existing .vscode/mcp.json is not overwritten.

.NOTES
    Requires Pester v5+, git, node>=18, npm.
    Run with:  Invoke-Pester -Path scripts/tests/install.Tests.ps1
#>

#requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0.0' }

BeforeAll {
    $script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:InstallPs1 = Join-Path $script:RepoRoot 'scripts\install.ps1'

    if (-not (Test-Path $script:InstallPs1)) {
        throw "install.ps1 not found at $script:InstallPs1"
    }

    # Build a bare clone of the current working tree so the installer can
    # `git clone` it without hitting the network. We use --local so
    # uncommitted changes are NOT included; the test only validates whatever
    # is committed on the current branch.
    $script:BareRepo = Join-Path $TestDrive 'repo.git'
    & git clone --quiet --bare $script:RepoRoot $script:BareRepo 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create bare clone for tests."
    }

    # Detect the current branch so the installer's --branch flag works.
    $script:GitRef = (& git -C $script:RepoRoot rev-parse --abbrev-ref HEAD).Trim()
    if (-not $script:GitRef -or $script:GitRef -eq 'HEAD') { $script:GitRef = 'main' }

    # Pester v5 scopes test functions per-block; defining with `function script:`
    # makes Invoke-Installer visible inside every Describe/It below.
    function script:Invoke-Installer {
        param(
            [Parameter(Mandatory=$true)] [string]$WorkspaceDir,
            [hashtable]$EnvVars = @{}
        )

        $envBlock = @{
            PERSONAKIT_REPO_URL = "file:///$($script:BareRepo -replace '\\','/')"
            PERSONAKIT_REF      = $script:GitRef
            PERSONAKIT_DIR      = '.\.personakit-plugin'
        }
        foreach ($k in $EnvVars.Keys) { $envBlock[$k] = $EnvVars[$k] }

        $stdoutFile = Join-Path $TestDrive ("stdout-{0}.txt" -f ([guid]::NewGuid().ToString('N')))
        $stderrFile = Join-Path $TestDrive ("stderr-{0}.txt" -f ([guid]::NewGuid().ToString('N')))

        $envArgs = @()
        foreach ($k in $envBlock.Keys) {
            $envArgs += "`$env:$k = '$($envBlock[$k])'"
        }
        $envSetup = $envArgs -join '; '

        $cmd = "$envSetup; Set-Location -LiteralPath '$WorkspaceDir'; & '$($script:InstallPs1)'"

        $proc = Start-Process -FilePath 'pwsh' `
            -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', $cmd) `
            -RedirectStandardOutput $stdoutFile `
            -RedirectStandardError $stderrFile `
            -PassThru -Wait -WindowStyle Hidden

        return [pscustomobject]@{
            ExitCode = $proc.ExitCode
            StdOut   = (Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue)
            StdErr   = (Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue)
        }
    }
}

Describe 'install.ps1 — fresh install' {
    BeforeAll {
        $script:Workspace = Join-Path $TestDrive 'fresh-workspace'
        New-Item -ItemType Directory -Path $script:Workspace -Force | Out-Null
        $script:Result = Invoke-Installer -WorkspaceDir $script:Workspace
    }

    It 'exits 0' {
        if ($script:Result.ExitCode -ne 0) {
            Write-Host "STDOUT:`n$($script:Result.StdOut)"
            Write-Host "STDERR:`n$($script:Result.StdErr)"
        }
        $script:Result.ExitCode | Should -Be 0
    }

    It 'clones the plugin into ./.personakit-plugin' {
        Test-Path (Join-Path $script:Workspace '.personakit-plugin\.git') | Should -BeTrue
    }

    It 'builds packages/personakit-mcp/dist/index.js' {
        Test-Path (Join-Path $script:Workspace '.personakit-plugin\packages\personakit-mcp\dist\index.js') |
            Should -BeTrue
    }

    It 'writes .vscode/mcp.json' {
        Test-Path (Join-Path $script:Workspace '.vscode\mcp.json') | Should -BeTrue
    }

    It 'mcp.json registers a stdio personakit server pointing at dist/index.js' {
        $json = Get-Content -LiteralPath (Join-Path $script:Workspace '.vscode\mcp.json') -Raw |
            ConvertFrom-Json
        $json.servers.personakit         | Should -Not -BeNullOrEmpty
        $json.servers.personakit.type    | Should -Be 'stdio'
        $json.servers.personakit.command | Should -Be 'node'
        $json.servers.personakit.args[0] | Should -Match 'personakit-mcp/dist/index\.js$'
    }
}

Describe 'install.ps1 — re-run is idempotent' {
    It 'succeeds when the clone already exists' {
        $ws = Join-Path $TestDrive 'rerun-workspace'
        New-Item -ItemType Directory -Path $ws -Force | Out-Null

        $r1 = Invoke-Installer -WorkspaceDir $ws
        $r1.ExitCode | Should -Be 0

        $r2 = Invoke-Installer -WorkspaceDir $ws
        if ($r2.ExitCode -ne 0) {
            Write-Host "STDOUT:`n$($r2.StdOut)"
            Write-Host "STDERR:`n$($r2.StdErr)"
        }
        $r2.ExitCode | Should -Be 0
    }
}

Describe 'install.ps1 — PERSONAKIT_NO_VSCODE=1' {
    It 'skips writing .vscode/mcp.json' {
        $ws = Join-Path $TestDrive 'no-vscode-workspace'
        New-Item -ItemType Directory -Path $ws -Force | Out-Null

        $r = Invoke-Installer -WorkspaceDir $ws -EnvVars @{ PERSONAKIT_NO_VSCODE = '1' }
        $r.ExitCode | Should -Be 0
        Test-Path (Join-Path $ws '.vscode\mcp.json') | Should -BeFalse
    }
}

Describe 'install.ps1 — preserves existing .vscode/mcp.json' {
    It 'leaves a pre-existing mcp.json untouched' {
        $ws = Join-Path $TestDrive 'existing-mcp-workspace'
        New-Item -ItemType Directory -Path (Join-Path $ws '.vscode') -Force | Out-Null
        $existing = '{ "servers": { "other": { "command": "echo" } } }'
        Set-Content -Path (Join-Path $ws '.vscode\mcp.json') -Value $existing -Encoding UTF8

        $r = Invoke-Installer -WorkspaceDir $ws
        $r.ExitCode | Should -Be 0

        (Get-Content -LiteralPath (Join-Path $ws '.vscode\mcp.json') -Raw).Trim() |
            Should -Be $existing
    }
}
