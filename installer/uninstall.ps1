<#
.SYNOPSIS
  JPE For Claude uninstaller for Windows (PowerShell 5.1 or newer).

.DESCRIPTION
  Removes the plugin through Claude Code's own commands. By default it KEEPS JPE's saved data (backups, caches,
  run records) so a reinstall can pick them up; pass -PurgeData to delete that data too. It only removes an
  alias skill that JPE itself installed. Your Claude Code settings are never edited by hand.

.PARAMETER Scope               user (default) or project.
.PARAMETER ProjectDir          Project folder for -Scope project (default: current folder).
.PARAMETER RemoveMarketplace   Also remove the jpe-marketplace entry.
.PARAMETER PurgeData           Also delete JPE's saved data.
.PARAMETER Yes                 Do not ask for confirmation.
.PARAMETER DryRun              Show what would be run and change nothing.
#>
[CmdletBinding()]
param(
  [ValidateSet('user', 'project')] [string]$Scope = 'user',
  [string]$ProjectDir = (Get-Location).Path,
  [switch]$RemoveMarketplace,
  [switch]$PurgeData,
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$MarketplaceName = 'jpe-marketplace'
$PluginId = "jpe@$MarketplaceName"

function Say($m) { Write-Host $m }
function Fail($m) { Write-Host "jpe-uninstall: $m" -ForegroundColor Red; exit 1 }
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

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail "the 'claude' command was not found on PATH." }

if ($Scope -eq 'project') { $aliasDir = Join-Path $ProjectDir '.claude\skills\jpe' }
else {
  $configRoot = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  $aliasDir = Join-Path $configRoot 'skills\jpe'
}
$aliasFile = Join-Path $aliasDir 'SKILL.md'
$aliasIsOurs = (Test-Path $aliasFile) -and (Select-String -Path $aliasFile -SimpleMatch 'jpe-alias v1' -Quiet)

Say 'This will:'
if ($PurgeData) { Say "  - uninstall $PluginId ($Scope scope) AND DELETE its saved data (backups, caches, run records)" } else { Say "  - uninstall $PluginId ($Scope scope), keeping its saved data" }
if ($RemoveMarketplace) { Say "  - remove the $MarketplaceName marketplace" }
if ($aliasIsOurs) { Say "  - remove the JPE alias skill at $aliasFile" }
Say 'Project files and your Claude Code settings are not touched, except the plugin entries Claude Code manages itself.'
if (-not (Confirm-Step 'Continue?')) { Fail 'cancelled; nothing was changed.' }

$uninstallArgs = @('plugin', 'uninstall', $PluginId, '--scope', $Scope)
if (-not $PurgeData) { $uninstallArgs += '--keep-data' }
if ($DryRun) { Say "  > claude $($uninstallArgs -join ' ')" } else { Invoke-Claude $uninstallArgs }

if ($RemoveMarketplace) {
  if ($DryRun) { Say "  > claude plugin marketplace remove $MarketplaceName" } else { Invoke-Claude @('plugin', 'marketplace', 'remove', $MarketplaceName) }
}

if (Test-Path $aliasFile) {
  if ($aliasIsOurs) {
    if ($DryRun) { Say "  > remove $aliasFile" } else {
      Remove-Item -LiteralPath $aliasFile -Force
      if (-not (Get-ChildItem -LiteralPath $aliasDir -Force)) { Remove-Item -LiteralPath $aliasDir -Force }
      Say 'Removed the JPE alias skill.'
    }
  } else {
    Say "A skill named jpe exists at $aliasFile but is not JPE's alias; it was left alone."
  }
}

if ($DryRun) { Say 'Dry run finished; nothing was changed.'; exit 0 }
if ((Get-ClaudeText @('plugin', 'list')) -match [regex]::Escape($PluginId)) {
  Fail 'jpe still appears in `claude plugin list` for this scope (it may be installed in another scope). Re-run with the right -Scope.'
}
Say "JPE is uninstalled from the $Scope scope."
