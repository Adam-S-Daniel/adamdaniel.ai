# Skills mirror bootstrap (native Windows).
# Idempotent. Safe to run from a sessionStart hook on every Claude Code session.
# Tries SymbolicLink (needs Developer Mode or admin) first, falls back to a
# directory junction (no elevation required).
#Requires -Version 5

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location $RepoRoot

$AgentsDir         = '.agents/skills'
$MirrorDir         = '.claude/skills'
$MirrorTargetRel   = '../.agents/skills'
$GitconfigFragment = '.gitconfig-fragment'
$HooksDir          = '.githooks'

function Write-Bootstrap {
    param([string]$Message, [switch]$Err)
    if ($Err) { [Console]::Error.WriteLine("bootstrap: $Message") }
    else      { Write-Host "bootstrap: $Message" }
}

function Test-DirHasContent {
    param([string]$Path)
    if (-not (Test-Path $Path -PathType Container)) { return $false }
    return (Get-ChildItem -Force -LiteralPath $Path -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
}

function Test-IsLinkLike {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -Force -LiteralPath $Path
    # Reparse points cover both SymbolicLink and Junction.
    return ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

# Ensure parent directories exist.
foreach ($d in @('.claude', '.agents')) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -ItemType Directory -Path $d | Out-Null
    }
}

# 1. Migration: handle existing real .claude/skills directory.
if ((Test-Path -LiteralPath $MirrorDir) -and (-not (Test-IsLinkLike -Path $MirrorDir))) {
    if (Test-Path -LiteralPath $MirrorDir -PathType Leaf) {
        # Likely a "fake symlink" file from a checkout with core.symlinks=false
        # on Windows. Discard it; the real link is recreated below.
        Write-Bootstrap "Removing stale plain file at $MirrorDir (was probably a checkout-emitted text symlink)"
        Remove-Item -LiteralPath $MirrorDir -Force
    } elseif (-not (Test-Path -LiteralPath $MirrorDir -PathType Container)) {
        Write-Bootstrap -Err "ERROR: $MirrorDir exists but is not a regular file, directory, or link."
        exit 2
    }
}

if ((Test-Path -LiteralPath $MirrorDir -PathType Container) -and (-not (Test-IsLinkLike -Path $MirrorDir))) {
    $mirrorHas = Test-DirHasContent -Path $MirrorDir
    $agentsHas = Test-DirHasContent -Path $AgentsDir

    if ($mirrorHas -and $agentsHas) {
        Write-Bootstrap -Err "ERROR: Both $AgentsDir and $MirrorDir contain content."
        Write-Bootstrap -Err "Cannot auto-merge - please consolidate manually."
        Write-Bootstrap -Err "  $AgentsDir contains:"
        Get-ChildItem -Force -LiteralPath $AgentsDir | ForEach-Object {
            [Console]::Error.WriteLine("    $($_.Name)")
        }
        Write-Bootstrap -Err "  $MirrorDir contains:"
        Get-ChildItem -Force -LiteralPath $MirrorDir | ForEach-Object {
            [Console]::Error.WriteLine("    $($_.Name)")
        }
        exit 2
    }

    if ($mirrorHas) {
        Write-Bootstrap "Migrating $MirrorDir contents into $AgentsDir"
        if (-not (Test-Path -LiteralPath $AgentsDir)) {
            New-Item -ItemType Directory -Path $AgentsDir | Out-Null
        }
        Get-ChildItem -Force -LiteralPath $MirrorDir | ForEach-Object {
            Move-Item -LiteralPath $_.FullName -Destination $AgentsDir -Force
        }
    }

    Remove-Item -LiteralPath $MirrorDir -Force
}

if (-not (Test-Path -LiteralPath $AgentsDir)) {
    New-Item -ItemType Directory -Path $AgentsDir | Out-Null
}

# 2. Create or repair the link.
$AgentsAbs = (Resolve-Path -LiteralPath $AgentsDir).Path

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

function New-MirrorLink {
    param([string]$LinkPath, [string]$TargetRel, [string]$TargetAbs)

    # Try SymbolicLink with the relative target first (matches Unix layout, portable).
    try {
        New-Item -ItemType SymbolicLink -Path $LinkPath -Target $TargetRel -ErrorAction Stop | Out-Null
        Write-Bootstrap "Created symlink: $LinkPath -> $TargetRel"
        return
    } catch {
        Write-Bootstrap "SymbolicLink unavailable, falling back to junction: $($_.Exception.Message)"
    }

    # mklink /J requires absolute paths and Windows-style backslashes.
    $linkWin   = ($LinkPath  -replace '/', '\')
    $targetWin = ($TargetAbs -replace '/', '\')
    & cmd /c "mklink /J `"$linkWin`" `"$targetWin`"" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create directory junction at $LinkPath"
    }
    Write-Bootstrap "Created junction: $LinkPath -> $TargetAbs"
}

if (Test-IsLinkLike -Path $MirrorDir) {
    $resolved = Get-LinkRealPath -Path $MirrorDir
    if (-not $resolved -or $resolved -ne $AgentsAbs) {
        $current = (Get-Item -Force -LiteralPath $MirrorDir).Target
        if ($current -is [System.Array]) { $current = $current[0] }
        Write-Bootstrap "Repairing $MirrorDir link (was: $current)"
        Remove-Item -LiteralPath $MirrorDir -Force -Recurse:$false
        New-MirrorLink -LinkPath $MirrorDir -TargetRel $MirrorTargetRel -TargetAbs $AgentsAbs
    }
} elseif (-not (Test-Path -LiteralPath $MirrorDir)) {
    New-MirrorLink -LinkPath $MirrorDir -TargetRel $MirrorTargetRel -TargetAbs $AgentsAbs
}

# 3. Git-local config: symlinks on, hook registration.
$gitAvailable = (Get-Command git -ErrorAction SilentlyContinue) -ne $null
if ($gitAvailable) {
    $insideRepo = $false
    try {
        & git rev-parse --is-inside-work-tree 2>$null | Out-Null
        $insideRepo = ($LASTEXITCODE -eq 0)
    } catch { }

    if ($insideRepo) {
        & git config --local core.symlinks true 2>$null | Out-Null

        $gitVersion = (& git --version) -replace '^git version ', ''
        $parts = ($gitVersion -split '\.')
        $major = 0; $minor = 0
        if ($parts.Count -ge 2 -and $parts[0] -match '^\d+$' -and $parts[1] -match '^\d+$') {
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
        }
        $useConfigHooks = ($major -gt 2 -or ($major -eq 2 -and $minor -ge 54))

        if ($useConfigHooks -and (Test-Path -LiteralPath $GitconfigFragment)) {
            $includeValue = "../$GitconfigFragment"
            $existing = (& git config --local --get-all include.path 2>$null)
            if (-not ($existing -split "`n" | Where-Object { $_ -eq $includeValue })) {
                & git config --local --add include.path $includeValue
            }
        } elseif (Test-Path -LiteralPath $HooksDir) {
            & git config --local core.hooksPath $HooksDir | Out-Null
        }
    }
}

# 4. Run verify if present.
$verifyPs1 = Join-Path $ScriptDir 'verify-skills-mirror.ps1'
if (Test-Path -LiteralPath $verifyPs1) {
    & $verifyPs1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Bootstrap "OK"
