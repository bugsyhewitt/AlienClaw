# AlienClaw Windows Installer (PowerShell)
# Works on Windows with PowerShell 5.1+ and Node.js
param(
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$OPENCLAW_HOME = "$env:USERPROFILE\.openclaw"
$ALIENCLAW_HOME = "$env:USERPROFILE\.alienclaw"
$REPO_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$AGENTS_ROOT = "$OPENCLAW_HOME\agents"
$AGENT_IDS = @("bossbot", "advisorbot", "creatorbot")

function Write-Step($msg) {
    Write-Host "  ==> $msg" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "  ✔ $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "  ⚠ $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
    Write-Host "  ✘ $msg" -ForegroundColor Red
    exit 1
}

# ── Uninstall path ───────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Step "Uninstalling AlienClaw agents (OpenClaw itself is left alone)"
    foreach ($id in $AGENT_IDS) {
        $target = "$AGENTS_ROOT\$id"
        if (Test-Path $target) {
            $archive = "$AGENTS_ROOT\_uninstalled_${id}_$(Get-Date -UnixTimeSeconds)"
            Move-Item -Path $target -Destination $archive -Force
            Write-Success "Archived $id → $archive"
        }
    }
    Write-Host ""
    Write-Host "AlienClaw agents removed. OpenClaw is still installed." -ForegroundColor Green
    exit 0
}

# ── 1. Check OpenClaw ───────────────────────────────────────────────────────
Write-Step "Checking for OpenClaw"
try {
    $openclawVersion = openclaw --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
} catch {
    Write-Fail "OpenClaw is not installed. Run: npm install -g openclaw"
}
Write-Success "OpenClaw found: $openclawVersion"

# ── 2. Probe workspace layout ───────────────────────────────────────────────
Write-Step "Probing OpenClaw workspace layout"
$probeDir = "$AGENTS_ROOT\_probe_$(Get-Date -UnixTimeSeconds)"
$layoutSubdir = ""

try {
    New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
    $setupOutput = openclaw setup --workspace $probeDir 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Used 'openclaw setup' layout"
    } else {
        Write-Warn "Falling back to default layout (files at agent root)"
        "" | Out-File -FilePath "$probeDir\.layout-fallback"
    }
} catch {
    Write-Warn "Probing failed, using default layout"
}

# Detect layout
if (Test-Path "$probeDir\workspace\SOUL.md") {
    $layoutSubdir = "workspace"
    Write-Success "Detected layout: files under <agent>\workspace\"
} else {
    $layoutSubdir = ""
    Write-Success "Detected layout: files at <agent> root"
}

Remove-Item -Path $probeDir -Recurse -Force -ErrorAction SilentlyContinue

# ── 3. Archive pre-existing agents ──────────────────────────────────────────
Write-Step "Archiving pre-existing default OpenClaw agent"
$toArchive = @("$OPENCLAW_HOME\workspace", "$AGENTS_ROOT\main")
foreach ($candidate in $toArchive) {
    if (Test-Path $candidate -PathType Container) {
        $archive = "$AGENTS_ROOT\_archived_$(Split-Path $candidate -Leaf)_$(Get-Date -UnixTimeSeconds)"
        New-Item -ItemType Directory -Path $AGENTS_ROOT -Force | Out-Null
        Move-Item -Path $candidate -Destination $archive -Force
        Write-Success "Archived $candidate → $archive (not deleted)"
    }
}

# ── 4. Provision three AlienClaw agents ─────────────────────────────────────
Write-Step "Provisioning AlienClaw agents"
New-Item -ItemType Directory -Path $AGENTS_ROOT -Force | Out-Null

foreach ($id in $AGENT_IDS) {
    $src = "$REPO_ROOT\seed\agents\$id"
    if (-not (Test-Path $src)) {
        Write-Fail "Seed folder not found: $src"
    }

    $target = "$AGENTS_ROOT\$id"
    if ($layoutSubdir) {
        $target = "$target\$layoutSubdir"
    }

    if (Test-Path $target) {
        Write-Warn "Target $target already exists — archiving before overwrite"
        $archive = "${target}_replaced_$(Get-Date -UnixTimeSeconds)"
        Move-Item -Path $target -Destination $archive -Force
    }

    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path "$src\*" -Destination $target -Recurse -Force
    Write-Success "Installed agent: $id → $target"
}

# ── 5. Patch openclaw.json ──────────────────────────────────────────────────
Write-Step "Setting BossBot as the default agent"
$cfg = "$OPENCLAW_HOME\openclaw.json"

$backup = "$cfg.backup-$(Get-Date -UnixTimeSeconds)"
if (Test-Path $cfg) {
    Copy-Item -Path $cfg -Destination $backup -Force
    Write-Success "Backed up: $cfg → $backup"
}

# Read and update openclaw.json using Node.js for JSON parsing
$jsonContent = Get-Content -Path $cfg -Raw -ErrorAction SilentlyContinue
if ($jsonContent) {
    try {
        $config = $jsonContent | ConvertFrom-Json -AsHashtable
    } catch {
        Write-Warn "Could not parse openclaw.json. Skipping default agent update."
    }

    if ($config) {
        $config["agents"] = $config.get_Item("agents") @{}
        $config["agents"]["defaults"] = $config["agents"].get_Item("defaults") @{}
        $config["agents"]["defaults"]["agentId"] = "bossbot"
        $config["agents"]["defaults"]["workspace"] = "$AGENTS_ROOT\bossbot"

        # Remove legacy flat agent entries for our three agents
        $config["agents"]["list"] = @($config["agents"]["list"] | Where-Object {
            $_.id -notin @("bossbot", "advisorbot", "creatorbot")
        })

        $updated = $config | ConvertTo-Json -Depth 10
        Set-Content -Path $cfg -Value $updated -Encoding UTF8
        Write-Success "openclaw.json updated: agents.defaults.agentId = bossbot"
    }
}

# ── 6. Done ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  👽  ALIENCLAW INSTALLED" -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════" -ForegroundColor Green
Write-Host "  Default agent : BossBot"
Write-Host "  Peers         : AdvisorBot (🧠), CreatorBot (🔧)"
Write-Host "  Agents root   : $AGENTS_ROOT"
Write-Host ""
Write-Host "  Start a chat   : openclaw chat" -ForegroundColor Cyan
Write-Host "  List agents    : openclaw agents list" -ForegroundColor Cyan
Write-Host "  Uninstall      : powershell -File $REPO_ROOT\scripts\install-alienclaw.ps1 -Uninstall" -ForegroundColor Cyan