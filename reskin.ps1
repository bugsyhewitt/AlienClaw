#!/usr/bin/env pwsh
# AlienClaw Phase 1 — Reskin Script (PowerShell)
# Usage: .\reskin.ps1              # dry-run (shows what will change)
#        .\reskin.ps1 -Execute     # apply changes
#
# Run from repo root: C:\alienclaw

param(
    [switch]$Execute
)

$RepoRoot = $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = Get-Location }

$DryRun = -not $Execute

# ── Replacement pairs (order matters — longest/most specific first) ──────────
$Replacements = @(
    # Paths / env vars
    @{ From = '~/.alienclaw';    To = '~/.alienclaw' },
    @{ From = 'ALIENCLAW_HOME';  To = 'ALIENCLAW_HOME' },
    @{ From = 'ALIENCLAW_';      To = 'ALIENCLAW_' },
    # Title case
    @{ From = 'AlienClaw';       To = 'AlienClaw' },
    # All-caps
    @{ From = 'ALIENCLAW';       To = 'ALIENCLAW' },
    # Lowercase
    @{ From = 'alienclaw';       To = 'alienclaw' },
    # Docs URL
    @{ From = 'docs.alienclaw.ai'; To = 'docs.alienclaw.ai' }
)

# ── Directories / extensions to skip ─────────────────────────────────────────
$SkipDirs = @('node_modules', '.git', '.pnpm-store', 'dist', '.turbo')
$SkipExtensions = @('.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff',
                    '.woff2', '.ttf', '.eot', '.mp3', '.wav', '.zip', '.tar',
                    '.gz', '.bin', '.exe', '.node', '.map')

$TotalFiles   = 0
$ChangedFiles = 0
$RenamedFiles = 0

function Should-Skip($path) {
    foreach ($dir in $SkipDirs) {
        if ($path -match [regex]::Escape([IO.Path]::DirectorySeparatorChar + $dir + [IO.Path]::DirectorySeparatorChar) `
            -or $path -match [regex]::Escape([IO.Path]::DirectorySeparatorChar + $dir + '$')) {
            return $true
        }
    }
    $ext = [IO.Path]::GetExtension($path).ToLower()
    if ($SkipExtensions -contains $ext) { return $true }
    return $false
}

Write-Host ""
Write-Host "AlienClaw Reskin — Phase 1" -ForegroundColor Cyan
Write-Host "Repo root : $RepoRoot"
Write-Host "Mode      : $(if ($DryRun) { 'DRY-RUN (no changes written)' } else { 'EXECUTE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "──────────────────────────────────────────────────────────────────"

# ── 1. Text replacement in all source files ───────────────────────────────────
Get-ChildItem -Path $RepoRoot -Recurse -File | ForEach-Object {
    $file = $_
    if (Should-Skip $file.FullName) { return }

    $TotalFiles++
    $original = [IO.File]::ReadAllText($file.FullName)
    $updated  = $original

    foreach ($r in $Replacements) {
        $updated = $updated.Replace($r.From, $r.To)
    }

    if ($updated -ne $original) {
        $ChangedFiles++
        Write-Host "  MODIFY  $($file.FullName.Replace($RepoRoot, '.'))" -ForegroundColor White
        if (-not $DryRun) {
            [IO.File]::WriteAllText($file.FullName, $updated)
        }
    }
}

Write-Host ""
Write-Host "── File renames ────────────────────────────────────────────────────"

# ── 2. Rename alienclaw.mjs → alienclaw.mjs ────────────────────────────────────
Get-ChildItem -Path $RepoRoot -Recurse -File -Filter 'alienclaw.mjs' | ForEach-Object {
    $RenamedFiles++
    $newPath = Join-Path $_.DirectoryName 'alienclaw.mjs'
    Write-Host "  RENAME  $($_.FullName.Replace($RepoRoot,'.'))  →  alienclaw.mjs" -ForegroundColor Magenta
    if (-not $DryRun) { Rename-Item -Path $_.FullName -NewName 'alienclaw.mjs' }
}

# ── 3. Rename any other files with 'alienclaw' in their name ──────────────────
Get-ChildItem -Path $RepoRoot -Recurse -File | Where-Object {
    $_.Name -match 'alienclaw' -and $_.Name -ne 'alienclaw.mjs'
} | ForEach-Object {
    $newName = $_.Name -replace 'alienclaw', 'alienclaw'
    $RenamedFiles++
    Write-Host "  RENAME  $($_.FullName.Replace($RepoRoot,'.'))  →  $newName" -ForegroundColor Magenta
    if (-not $DryRun) { Rename-Item -Path $_.FullName -NewName $newName }
}

# ── 4. package.json — name + bin fields ──────────────────────────────────────
Write-Host ""
Write-Host "── package.json ────────────────────────────────────────────────────"
$pkgPath = Join-Path $RepoRoot 'package.json'
if (Test-Path $pkgPath) {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $changed = $false

    if ($pkg.name -match 'alienclaw') {
        $newName = $pkg.name -replace 'alienclaw','alienclaw'
        Write-Host "  name: $($pkg.name) → $newName" -ForegroundColor White
        if (-not $DryRun) { $pkg.name = $newName }
        $changed = $true
    }
    if ($pkg.bin) {
        $pkg.bin.PSObject.Properties | ForEach-Object {
            if ($_.Name -match 'alienclaw' -or $_.Value -match 'alienclaw') {
                $newKey = $_.Name  -replace 'alienclaw','alienclaw'
                $newVal = $_.Value -replace 'alienclaw','alienclaw'
                Write-Host "  bin: $($_.Name)=$($_.Value) → $newKey=$newVal" -ForegroundColor White
                if (-not $DryRun) {
                    $pkg.bin | Add-Member -NotePropertyName $newKey -NotePropertyValue $newVal -Force
                    if ($newKey -ne $_.Name) { $pkg.bin.PSObject.Properties.Remove($_.Name) }
                }
                $changed = $true
            }
        }
    }
    if ($changed -and -not $DryRun) {
        $pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath
    }
    if (-not $changed) { Write-Host "  (no alienclaw references found in package.json)" }
} else {
    Write-Host "  package.json not found at $pkgPath" -ForegroundColor Red
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "──────────────────────────────────────────────────────────────────"
Write-Host "Files scanned  : $TotalFiles"
Write-Host "Files to modify: $ChangedFiles" -ForegroundColor $(if ($ChangedFiles -gt 0) { 'Yellow' } else { 'Green' })
Write-Host "Files to rename: $RenamedFiles" -ForegroundColor $(if ($RenamedFiles -gt 0) { 'Magenta' } else { 'Green' })

if ($DryRun) {
    Write-Host ""
    Write-Host "DRY-RUN complete. No files were changed." -ForegroundColor Yellow
    Write-Host "Run with -Execute to apply:  .\reskin.ps1 -Execute" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Reskin complete." -ForegroundColor Green
    Write-Host "Next: pnpm install && pnpm build  — then verify with: alienclaw --version"
}
