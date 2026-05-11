<#
.SYNOPSIS
    Pester tests for scripts/install.ps1.

.DESCRIPTION
    End-to-end test of the installer that runs fully offline:
      1. Builds a zip of the working tree (shaped like a GitHub source
         archive: a single top-level folder containing the repo).
      2. Points the installer at it via PERSONAKIT_ARCHIVE_URL=file://...
      3. Runs the installer into a sandbox workspace and asserts:
         - exits 0,
         - source extracted into ./.personakit-plugin,
         - .personakit-version stamp written,
         - MCP server built (dist/index.js exists),
         - .vscode/mcp.json registers the server,
         - re-running is idempotent (replaces previous install),
         - PERSONAKIT_NO_VSCODE=1 skips the .vscode write,
         - existing .vscode/mcp.json is preserved,
         - install refuses to overwrite a non-Personakit target dir.

.NOTES
    Requires Pester v5+, node>=18, npm. (No git required — installer is HTTP.)
    Run with:  Invoke-Pester -Path scripts/tests/install.Tests.ps1
#>

#requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0.0' }

BeforeAll {
    $script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:InstallPs1 = Join-Path $script:RepoRoot 'scripts\install.ps1'

    if (-not (Test-Path $script:InstallPs1)) {
        throw "install.ps1 not found at $script:InstallPs1"
    }

    # Build a zip of the working tree shaped like a GitHub source archive:
    # a single top-level folder containing the repo contents. Excludes
    # node_modules and dist for speed (npm install/build runs during the test).
    $stage = Join-Path $TestDrive 'stage'
    $top   = Join-Path $stage 'personakit-test'
    New-Item -ItemType Directory -Path $top -Force | Out-Null

    Get-ChildItem -Path $script:RepoRoot -Force |
        Where-Object { $_.Name -ne '.git' -and $_.Name -ne 'node_modules' } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $top -Recurse -Force `
                -Exclude @('node_modules', 'dist')
        }

    $script:ArchiveZip = Join-Path $TestDrive 'repo.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $script:ArchiveZip -Force

    # file:///d:/path/repo.zip — three slashes, forward separators.
    $script:ArchiveUrl = "file:///$($script:ArchiveZip -replace '\\','/')"

    function script:Invoke-Installer {
        param(
            [Parameter(Mandatory=$true)] [string]$WorkspaceDir,
            [hashtable]$EnvVars = @{}
        )

        $envBlock = @{
            PERSONAKIT_ARCHIVE_URL = $script:ArchiveUrl
            PERSONAKIT_REF         = 'test'
            PERSONAKIT_DIR         = '.\.personakit-plugin'
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

    It 'extracts the source into ./.personakit-plugin' {
        Test-Path (Join-Path $script:Workspace '.personakit-plugin\package.json') | Should -BeTrue
    }

    It 'writes a .personakit-version stamp with ref + archive_url' {
        $stampFile = Join-Path $script:Workspace '.personakit-plugin\.personakit-version'
        Test-Path $stampFile | Should -BeTrue
        $stamp = Get-Content -LiteralPath $stampFile -Raw | ConvertFrom-Json
        $stamp.ref         | Should -Be 'test'
        $stamp.archive_url | Should -Be $script:ArchiveUrl
        $stamp.installed   | Should -Not -BeNullOrEmpty
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

Describe 'install.ps1 — re-run is idempotent (replaces previous install)' {
    It 'succeeds when the install dir already exists' {
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
        Test-Path (Join-Path $ws '.personakit-plugin\.personakit-version') | Should -BeTrue
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

Describe 'install.ps1 — refuses to overwrite a non-Personakit target dir' {
    It 'exits non-zero and leaves the target untouched' {
        $ws = Join-Path $TestDrive 'unsafe-target-workspace'
        $target = Join-Path $ws '.personakit-plugin'
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Set-Content -Path (Join-Path $target 'IMPORTANT.txt') -Value 'do not delete' -Encoding UTF8

        $r = Invoke-Installer -WorkspaceDir $ws
        $r.ExitCode | Should -Not -Be 0
        Test-Path (Join-Path $target 'IMPORTANT.txt') | Should -BeTrue
    }
}
