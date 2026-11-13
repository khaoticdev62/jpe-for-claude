#!/usr/bin/env sh
# JPE For Claude uninstaller for Linux and macOS.
#
# Removes the plugin through Claude Code's own commands. By default it KEEPS JPE's saved data (backups, caches,
# run records) so a reinstall can pick them up; pass --purge-data to delete that data too. It only removes an
# alias skill that JPE itself installed. Your Claude Code settings are never edited by hand.
#
#   sh uninstall.sh [--scope user|project] [--project-dir DIR] [--remove-marketplace] [--purge-data] [--yes] [--dry-run]
#
set -eu

MARKETPLACE_NAME="jpe-marketplace"
PLUGIN_ID="jpe@${MARKETPLACE_NAME}"
SCOPE="user"
PROJECT_DIR="$(pwd)"
REMOVE_MARKETPLACE=0
PURGE=0
ASSUME_YES=0
DRY_RUN=0

say() { printf '%s\n' "$*"; }
die() { printf 'jpe-uninstall: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) [ $# -ge 2 ] || die "--scope needs a value"; SCOPE="$2"; shift 2 ;;
    --project-dir) [ $# -ge 2 ] || die "--project-dir needs a value"; PROJECT_DIR="$2"; shift 2 ;;
    --remove-marketplace) REMOVE_MARKETPLACE=1; shift ;;
    --purge-data) PURGE=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done
case "$SCOPE" in user|project) ;; *) die "--scope must be user or project" ;; esac
command -v claude >/dev/null 2>&1 || die "the 'claude' command was not found on PATH."

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r answer || answer=""
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

in_scope() { if [ "$SCOPE" = "project" ]; then (cd "$PROJECT_DIR" && "$@"); else "$@"; fi; }

if [ "$SCOPE" = "project" ]; then ALIAS_DIR="$PROJECT_DIR/.claude/skills/jpe"; else ALIAS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/jpe"; fi
ALIAS="$ALIAS_DIR/SKILL.md"

say "This will:"
if [ "$PURGE" -eq 1 ]; then say "  - uninstall $PLUGIN_ID ($SCOPE scope) AND DELETE its saved data (backups, caches, run records)"; else say "  - uninstall $PLUGIN_ID ($SCOPE scope), keeping its saved data"; fi
[ "$REMOVE_MARKETPLACE" -eq 1 ] && say "  - remove the $MARKETPLACE_NAME marketplace"
if [ -f "$ALIAS" ] && grep -q 'jpe-alias v1' "$ALIAS" 2>/dev/null; then say "  - remove the JPE alias skill at $ALIAS"; fi
say "Project files and your Claude Code settings are not touched, except the plugin entries Claude Code manages itself."
confirm "Continue?" || die "cancelled; nothing was changed."

if [ "$DRY_RUN" -eq 1 ]; then
  say "  > claude plugin uninstall $PLUGIN_ID --scope $SCOPE$([ "$PURGE" -eq 1 ] || printf ' --keep-data')"
else
  if [ "$PURGE" -eq 1 ]; then in_scope claude plugin uninstall "$PLUGIN_ID" --scope "$SCOPE"; else in_scope claude plugin uninstall "$PLUGIN_ID" --scope "$SCOPE" --keep-data; fi
fi

if [ "$REMOVE_MARKETPLACE" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then say "  > claude plugin marketplace remove $MARKETPLACE_NAME"; else in_scope claude plugin marketplace remove "$MARKETPLACE_NAME"; fi
fi

if [ -f "$ALIAS" ]; then
  if grep -q 'jpe-alias v1' "$ALIAS" 2>/dev/null; then
    if [ "$DRY_RUN" -eq 1 ]; then say "  > remove $ALIAS"; else rm -f "$ALIAS" && rmdir "$ALIAS_DIR" 2>/dev/null || true; say "Removed the JPE alias skill."; fi
  else
    say "A skill named jpe exists at $ALIAS but is not JPE's alias; it was left alone."
  fi
fi

[ "$DRY_RUN" -eq 1 ] && { say "Dry run finished; nothing was changed."; exit 0; }
if in_scope claude plugin list 2>/dev/null | grep -q "$PLUGIN_ID"; then
  die "jpe still appears in 'claude plugin list' for this scope (it may be installed in another scope). Re-run with the right --scope."
fi
say "JPE is uninstalled from the $SCOPE scope."
