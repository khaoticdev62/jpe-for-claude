<#
.SYNOPSIS
  JPE For Claude installer for Windows (PowerShell 5.1 or newer).

.DESCRIPTION
  Installs (or updates) the JPE plugin from the local package this script ships in, using Claude Code's own
  plugin commands. It downloads nothing, asks before every change, and never edits Claude Code settings by hand.
  Use -DryRun to see exactly what would be run.

.PARAMETER Scope          user (all your projects, default) or project (one project).
.PARAMETER ProjectDir     Project folder for -Scope project (default: current folder).
.PARAMETER Source         Path to the jpe-marketplace folder (default: the one beside this script).
.PARAMETER Alias          Also install the optional /jpe alias skill.
.PARAMETER ForceAlias     Replace an existing, different skill named jpe (a backup copy is kept).
.PARAMETER Update         Update an existing install: shows release notes, backs up JPE configuration first.
.PARAMETER Yes            Do not ask for confirmation.
.PARAMETER DryRun         Show what would be run and change nothing.
#>
[CmdletBinding()]
param(
  [ValidateSet('user', 'project')] [string]$Scope = 'user',
  [string]$ProjectDir = (Get-Location).Path,
  [string]$Source = '',
  [switch]$Alias,
  [switch]$NoAlias,
  [switch]$ForceAlias,
  [switch]$Update,
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$MarketplaceName = 'jpe-marketplace'
$PluginId = "jpe@$MarketplaceName"

function Say($m) { Write-Host $m }
function Fail($m) { Write-Host "jpe-install: $m" -ForegroundColor Red; exit 1 }
function Confirm-Step($q) {
  if ($Yes -or $DryRun) { return $true }
  $a = Read-Host "$q [y/N]"
  return ($a -match '^(y|yes)$')
}
function Invoke-Claude {
  param([string[]]$Arguments)
  if ($Scope -eq 'project') { Push-Location $ProjectDir }
  try {
    & claude @Arguments
    if ($LASTEXITCODE -ne 0) { throw "claude $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
  } finally {
    if ($Scope -eq 'project') { Pop-Location }
  }
}
function Get-ClaudeText {
  param([string[]]$Arguments)
  if ($Scope -eq 'project') { Push-Location $ProjectDir }
  try { return (& claude @Arguments 2>$null | Out-String) } finally { if ($Scope -eq 'project') { Pop-Location } }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Source) { $Source = Join-Path $ScriptDir '..\jpe-marketplace' }
if (-not (Test-Path (Join-Path $Source '.claude-plugin'))) { Fail "no marketplace found at: $Source (use -Source to point at the jpe-marketplace folder)" }
$Source = (Resolve-Path $Source).Path
$PackageRoot = (Resolve-Path (Join-Path $Source '..')).Path
$PluginDir = Join-Path $Source 'plugins\jpe'
$Cli = Join-Path $PluginDir 'dist\cli.js'

# 1. Requirements ---------------------------------------------------------------------------------------------
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail "the 'claude' command was not found on PATH. Install Claude Code first." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js was not found on PATH. JPE needs Node.js 20 or newer.' }
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Fail "Node.js $(& node -v) is too old; JPE needs 20 or newer." }
Say "Claude Code: $((& claude --version 2>$null | Select-Object -First 1))"
Say "Node.js:     $(& node -v)"

# 2. Verify the package before changing anything ------------------------------------------------------------------
$sumsFile = Join-Path $PackageRoot 'SHA256SUMS'
if (Test-Path $sumsFile) {
  Say 'Verifying package checksums...'
  $bad = @()
  foreach ($line in Get-Content $sumsFile) {
    if (-not $line.Trim()) { continue }
    $hash, $rel = $line -split '  ', 2
    $file = Join-Path $PackageRoot ($rel -replace '/', '\')
    if (-not (Test-Path $file)) { $bad += "$rel (missing)"; continue }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    if ($actual -ne $hash) { $bad += $rel }
  }
  if ($bad.Count -gt 0) { Fail "checksum verification FAILED for: $($bad -join ', '). The package was changed or damaged; nothing was installed." }
  Say 'Checksums match.'
} else {
  Say 'NOTE: no SHA256SUMS file beside the package (development checkout); skipping checksum verification.'
}

$NewVersion = (Get-Content (Join-Path $PluginDir '.claude-plugin\plugin.json') -Raw | ConvertFrom-Json).version

# 3. Show the plan and ask ---------------------------------------------------------------------------------------------
if ($Scope -eq 'project') {
  if (-not (Test-Path $ProjectDir)) { Fail "project folder not found: $ProjectDir" }
  $ProjectDir = (Resolve-Path $ProjectDir).Path
  Say "Scope: project ($ProjectDir). This adds JPE to that project's Claude Code settings."
} else {
  Say 'Scope: user. JPE will be available in all your projects.'
}
Say "Version to install: $NewVersion"

if ($Update -and (Test-Path (Join-Path $PackageRoot 'CHANGELOG.md'))) {
  Say ''
  Say 'Release notes (top of CHANGELOG.md):'
  Get-Content (Join-Path $PackageRoot 'CHANGELOG.md') -TotalCount 25 | ForEach-Object { Say "  | $_" }
  Say ''
}

Say 'This will run:'
Say "  claude plugin marketplace add `"$Source`" --scope $Scope   (skipped if already added)"
if ($Update) { Say "  claude plugin marketplace update $MarketplaceName"; Say "  claude plugin update $PluginId --scope $Scope" } else { Say "  claude plugin install $PluginId --scope $Scope" }
if (-not (Confirm-Step 'Continue?')) { Fail 'cancelled; nothing was changed.' }

# 4. Back up JPE's own configuration before an update -------------------------------------------------------------------
if ($Update -and -not $DryRun -and (Test-Path $Cli)) {
  $line = (& node $Cli config path 2>$null) | Where-Object { $_ -match '^global:' } | Select-Object -First 1
  if ($line) {
    $cfg = ($line -replace '^global:\s*', '').Trim()
    if (Test-Path $cfg) {
      $backup = "$cfg.bak-$(Get-Date -Format yyyyMMddHHmmss)"
      Copy-Item -LiteralPath $cfg -Destination $backup
      Say "Configuration backed up to: $backup"
    }
  }
}

# 5. Install or update --------------------------------------------------------------------------------------------------
$listed = Get-ClaudeText @('plugin', 'marketplace', 'list')
if ($listed -match [regex]::Escape($MarketplaceName)) {
  Say "Marketplace $MarketplaceName is already added."
} else {
  Say 'Adding marketplace:'
  if ($DryRun) { Say "  > claude plugin marketplace add $Source --scope $Scope" } else { Invoke-Claude @('plugin', 'marketplace', 'add', $Source, '--scope', $Scope) }
}
if ($Update) {
  Say 'Updating plugin:'
  if ($DryRun) { Say "  > claude plugin update $PluginId" } else { Invoke-Claude @('plugin', 'marketplace', 'update', $MarketplaceName); Invoke-Claude @('plugin', 'update', $PluginId, '--scope', $Scope) }
} else {
  Say 'Installing plugin:'
  if ($DryRun) { Say "  > claude plugin install $PluginId --scope $Scope" } else { Invoke-Claude @('plugin', 'install', $PluginId, '--scope', $Scope) }
}

# 6. Optional bare /jpe alias ------------------------------------------------------------------------------------------------
function Install-Alias {
  if ($Scope -eq 'project') { $targetDir = Join-Path $ProjectDir '.claude\skills\jpe' }
  else {
    $configRoot = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
    $targetDir = Join-Path $configRoot 'skills\jpe'
  }
  $target = Join-Path $targetDir 'SKILL.md'
  $template = Join-Path $ScriptDir 'alias\SKILL.md'
  if (-not (Test-Path $template)) { Say "Alias template not found at $template; skipping the alias."; return }
  if (Test-Path $target) {
    if (Select-String -Path $target -SimpleMatch 'jpe-alias v1' -Quiet) {
      Say "A JPE alias already exists at $target; refreshing it."
    } elseif ($ForceAlias -and (Confirm-Step "A DIFFERENT skill named jpe exists at $target. Replace it (a .bak copy is kept)?")) {
      if (-not $DryRun) { Copy-Item -LiteralPath $target -Destination "$target.bak-$(Get-Date -Format yyyyMMddHHmmss)" }
    } else {
      Say "A skill named jpe already exists at $target and is not JPE's alias, so it was NOT replaced. Re-run with -ForceAlias to replace it (a backup is kept)."
      return
    }
  }
  Say "Installing the /jpe alias skill to $target"
  if ($DryRun) { Say "  > copy $template -> $target" } else { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null; Copy-Item -LiteralPath $template -Destination $target -Force }
}

if ($Alias) { Install-Alias }
elseif (-not $NoAlias -and -not $Yes -and -not $DryRun) { if (Confirm-Step 'Also install the optional /jpe alias skill (reports clearly if the plugin is missing in a project)?') { Install-Alias } }

# 7. Verify -------------------------------------------------------------------------------------------------------------------------
if ($DryRun) { Say 'Dry run finished; nothing was changed.'; exit 0 }
Say ''
Say 'Checking the result:'
if ((Get-ClaudeText @('plugin', 'list')) -match 'jpe') { Say '  OK   claude plugin list shows jpe' } else { Fail 'claude plugin list does not show jpe. Installation did not complete.' }
if (Test-Path $Cli) {
  & node $Cli doctor | ForEach-Object { Say "  $_" }
  if ($LASTEXITCODE -ne 0) { Say '  Doctor reported problems (see above). Fix them or roll back with uninstall.ps1.'; exit 1 }
  Say '  Doctor finished without failures.'
}
Say ''
Say 'Done. Restart Claude Code (or run /reload-plugins), then type /jpe.'
