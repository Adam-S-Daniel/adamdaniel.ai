# Verify that .claude/skills is a link pointing at .agents/skills, and
# (with -Staged) that the staged diff contains no new regular files under
# .claude/skills/. Exits non-zero with a human-readable message on failure.
#Requires -Version 5

[CmdletBinding()]
param(
    [switch]$Staged
)

$ErrorActionPreference = 'Stop'
# Don't let PowerShell 7+ promote non-zero native-command exit codes
# (e.g. `git rev-parse` outside a repo) into terminating script errors.
$PSNativeCommandUseErrorActionPreference = $false

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location $RepoRoot

$errors = 0

function Test-IsLinkLike {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -Force -LiteralPath $Path
    return ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Get-LinkRealPath {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-Item -Force -LiteralPath $Path
    if ($item.LinkType -in @('SymbolicLink', 'Junction')) {
        $t = $item.Target
        if ($t -is [System.Array]) { $t = $t[0] }
        if (-not [IO.Path]::IsPathRooted($t)) {
            $t = Join-Path (Split-Path -Parent $item.FullName) $t
        }
        return [IO.Path]::GetFullPath($t)
    }
    return [IO.Path]::GetFullPath($item.FullName)
}

if (-not (Test-Path -LiteralPath '.claude/skills')) {
    [Console]::Error.WriteLine("FAIL: .claude/skills does not exist")
    $errors++
} elseif (-not (Test-IsLinkLike -Path '.claude/skills')) {
    [Console]::Error.WriteLine("FAIL: .claude/skills is a regular directory, not a symlink/junction.")
    [Console]::Error.WriteLine("      Run scripts/bootstrap.ps1 to repair.")
    $errors++
} else {
    $actual   = Get-LinkRealPath -Path '.claude/skills'
    $expected = Get-LinkRealPath -Path '.agents/skills'
    if (-not $actual -or -not $expected -or $actual -ne $expected) {
        [Console]::Error.WriteLine("FAIL: .claude/skills does not resolve to .agents/skills")
        [Console]::Error.WriteLine("      actual:   $actual")
        [Console]::Error.WriteLine("      expected: $expected")
        $errors++
    }
}

if (-not (Test-Path -LiteralPath '.agents/skills' -PathType Container)) {
    [Console]::Error.WriteLine("FAIL: .agents/skills does not exist")
    $errors++
} else {
    $hasSkill = Get-ChildItem -LiteralPath '.agents/skills' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if (Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md')) { return $true }
    }
    if (-not $hasSkill) {
        [Console]::Error.WriteLine("FAIL: .agents/skills contains no */SKILL.md")
        $errors++
    }
}

if ($Staged) {
    $gitAvailable = (Get-Command git -ErrorAction SilentlyContinue) -ne $null
    if ($gitAvailable) {
        $insideRepo = $false
        try {
            & git rev-parse --is-inside-work-tree 2>$null | Out-Null
            $insideRepo = ($LASTEXITCODE -eq 0)
        } catch { }

        if ($insideRepo) {
            $changed = & git diff --cached --name-status -- '.claude/skills/' 2>$null
            $bad = @()
            foreach ($line in ($changed -split "`n")) {
                if (-not $line) { continue }
                $parts = $line -split "`t", 2
                if ($parts.Count -lt 2) { continue }
                $status = $parts[0]
                $file   = $parts[1]
                if ($status -match '^[AM]') {
                    $modeLine = & git ls-files --stage -- $file 2>$null
                    if ($modeLine) {
                        $mode = ($modeLine -split '\s+')[0]
                        if ($mode -eq '100644' -or $mode -eq '100755') {
                            $bad += $file
                        }
                    }
                }
            }
            if ($bad.Count -gt 0) {
                [Console]::Error.WriteLine("FAIL: staged regular files under .claude/skills/. Edit .agents/skills/ instead:")
                foreach ($f in $bad) { [Console]::Error.WriteLine("  $f") }
                $errors++
            }
        }
    }
}

if ($errors -gt 0) {
    [Console]::Error.WriteLine("skills mirror verification failed ($errors error(s))")
    exit 1
}

Write-Host "skills mirror OK"
