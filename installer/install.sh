#!/usr/bin/env sh
# JPE For Claude installer for Linux and macOS.
#
# Installs (or updates) the JPE plugin from the local package that this script ships in, using Claude Code's
# own plugin commands. It downloads nothing, asks before every change, and never edits Claude Code settings
# by hand. Use --dry-run to see exactly what would be run.
#
#   sh install.sh [--scope user|project] [--project-dir DIR] [--source DIR] [--alias] [--update] [--yes] [--dry-run]
#
set -eu

MARKETPLACE_NAME="jpe-marketplace"
PLUGIN_ID="jpe@${MARKETPLACE_NAME}"
SCOPE="user"
PROJECT_DIR="$(pwd)"
SOURCE=""
WANT_ALIAS="ask"
UPDATE=0
ASSUME_YES=0
DRY_RUN=0
FORCE_ALIAS=0

say() { printf '%s\n' "$*"; }
die() { printf 'jpe-install: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) [ $# -ge 2 ] || die "--scope needs a value"; SCOPE="$2"; shift 2 ;;
    --project-dir) [ $# -ge 2 ] || die "--project-dir needs a value"; PROJECT_DIR="$2"; shift 2 ;;
    --source) [ $# -ge 2 ] || die "--source needs a value"; SOURCE="$2"; shift 2 ;;
    --alias) WANT_ALIAS="yes"; shift ;;
    --no-alias) WANT_ALIAS="no"; shift ;;
    --force-alias) FORCE_ALIAS=1; shift ;;
    --update) UPDATE=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

case "$SCOPE" in user|project) ;; *) die "--scope must be user or project" ;; esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -n "$SOURCE" ] || SOURCE="$SCRIPT_DIR/../jpe-marketplace"
[ -d "$SOURCE/.claude-plugin" ] || die "no marketplace found at: $SOURCE (use --source to point at the jpe-marketplace folder)"
SOURCE="$(cd "$SOURCE" && pwd)"
PACKAGE_ROOT="$(cd "$SOURCE/.." && pwd)"
PLUGIN_DIR="$SOURCE/plugins/jpe"
CLI="$PLUGIN_DIR/dist/cli.js"

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r answer || answer=""
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# 1. Requirements ------------------------------------------------------------------------------------------------
command -v claude >/dev/null 2>&1 || die "the 'claude' command was not found on PATH. Install Claude Code first."
command -v node >/dev/null 2>&1 || die "Node.js was not found on PATH. JPE needs Node.js 20 or newer."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "Node.js $(node -v) is too old; JPE needs 20 or newer."
say "Claude Code: $(claude --version 2>/dev/null | head -n 1)"
say "Node.js:     $(node -v)"

# 2. Verify the package before changing anything -------------------------------------------------------------------
if [ -f "$PACKAGE_ROOT/SHA256SUMS" ]; then
  say "Verifying package checksums..."
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$PACKAGE_ROOT" && sha256sum -c --quiet SHA256SUMS) || die "checksum verification FAILED. The package was changed or damaged; nothing was installed."
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$PACKAGE_ROOT" && shasum -a 256 -c --quiet SHA256SUMS) || die "checksum verification FAILED. The package was changed or damaged; nothing was installed."
  else
    die "neither sha256sum nor shasum is available, so the package cannot be verified. Nothing was installed."
  fi
  say "Checksums match."
else
  say "NOTE: no SHA256SUMS file beside the package (development checkout); skipping checksum verification."
fi

NEW_VERSION="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$PLUGIN_DIR/.claude-plugin/plugin.json")"

# 3. Show the plan and ask ---------------------------------------------------------------------------------------------
if [ "$SCOPE" = "project" ]; then
  [ -d "$PROJECT_DIR" ] || die "project folder not found: $PROJECT_DIR"
  PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
  say "Scope: project ($PROJECT_DIR). This adds JPE to that project's Claude Code settings."
else
  say "Scope: user. JPE will be available in all your projects."
fi
say "Version to install: $NEW_VERSION"

if [ "$UPDATE" -eq 1 ] && [ -f "$PACKAGE_ROOT/CHANGELOG.md" ]; then
  say ""
  say "Release notes (top of CHANGELOG.md):"
  sed -n '1,25p' "$PACKAGE_ROOT/CHANGELOG.md" | sed 's/^/  | /'
  say ""
fi

say "This will run:"
say "  claude plugin marketplace add \"$SOURCE\" --scope $SCOPE   (skipped if already added)"
if [ "$UPDATE" -eq 1 ]; then say "  claude plugin marketplace update $MARKETPLACE_NAME"; say "  claude plugin update $PLUGIN_ID --scope $SCOPE"; else say "  claude plugin install $PLUGIN_ID --scope $SCOPE"; fi
confirm "Continue?" || die "cancelled; nothing was changed."

in_scope() { if [ "$SCOPE" = "project" ]; then (cd "$PROJECT_DIR" && "$@"); else "$@"; fi; }

# 4. Back up JPE's own configuration before an update -----------------------------------------------------------------
if [ "$UPDATE" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] && [ -f "$CLI" ]; then
  GLOBAL_CFG="$(node "$CLI" config path 2>/dev/null | sed -n 's/^global: *//p')"
  if [ -n "$GLOBAL_CFG" ] && [ -f "$GLOBAL_CFG" ]; then
    BACKUP="$GLOBAL_CFG.bak-$(date +%Y%m%d%H%M%S)"
    cp "$GLOBAL_CFG" "$BACKUP" && say "Configuration backed up to: $BACKUP"
  fi
fi

# 5. Install or update ------------------------------------------------------------------------------------------------
if in_scope claude plugin marketplace list 2>/dev/null | grep -q "$MARKETPLACE_NAME"; then
  say "Marketplace $MARKETPLACE_NAME is already added."
else
  say "Adding marketplace:"
  if [ "$DRY_RUN" -eq 1 ]; then say "  > claude plugin marketplace add $SOURCE --scope $SCOPE"; else in_scope claude plugin marketplace add "$SOURCE" --scope "$SCOPE"; fi
fi

if [ "$UPDATE" -eq 1 ]; then
  say "Updating plugin:"
  if [ "$DRY_RUN" -eq 1 ]; then say "  > claude plugin update $PLUGIN_ID"; else in_scope claude plugin marketplace update "$MARKETPLACE_NAME"; in_scope claude plugin update "$PLUGIN_ID" --scope "$SCOPE"; fi
else
  say "Installing plugin:"
  if [ "$DRY_RUN" -eq 1 ]; then say "  > claude plugin install $PLUGIN_ID --scope $SCOPE"; else in_scope claude plugin install "$PLUGIN_ID" --scope "$SCOPE"; fi
fi

# 6. Optional bare /jpe alias -----------------------------------------------------------------------------------------------
install_alias() {
  if [ "$SCOPE" = "project" ]; then TARGET_DIR="$PROJECT_DIR/.claude/skills/jpe"; else TARGET_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/jpe"; fi
  TARGET="$TARGET_DIR/SKILL.md"
  TEMPLATE="$SCRIPT_DIR/alias/SKILL.md"
  [ -f "$TEMPLATE" ] || { say "Alias template not found at $TEMPLATE; skipping the alias."; return 0; }
  if [ -e "$TARGET" ]; then
    if grep -q 'jpe-alias v1' "$TARGET" 2>/dev/null; then
      say "A JPE alias already exists at $TARGET; refreshing it."
    elif [ "$FORCE_ALIAS" -eq 1 ] && confirm "A DIFFERENT skill named jpe exists at $TARGET. Replace it (a .bak copy is kept)?"; then
      [ "$DRY_RUN" -eq 1 ] || cp "$TARGET" "$TARGET.bak-$(date +%Y%m%d%H%M%S)"
    else
      say "A skill named jpe already exists at $TARGET and is not JPE's alias, so it was NOT replaced. Re-run with --force-alias to replace it (a backup is kept)."
      return 0
    fi
  fi
  say "Installing the /jpe alias skill to $TARGET"
  if [ "$DRY_RUN" -eq 1 ]; then say "  > copy $TEMPLATE -> $TARGET"; else mkdir -p "$TARGET_DIR" && cp "$TEMPLATE" "$TARGET"; fi
}

case "$WANT_ALIAS" in
  yes) install_alias ;;
  ask)
    if [ "$ASSUME_YES" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && confirm "Also install the optional /jpe alias skill (reports clearly if the plugin is missing in a project)?"; then install_alias; fi
    ;;
esac

# 7. Verify ----------------------------------------------------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then say "Dry run finished; nothing was changed."; exit 0; fi
say ""
say "Checking the result:"
if in_scope claude plugin list 2>/dev/null | grep -q "jpe"; then say "  OK   claude plugin list shows jpe"; else die "claude plugin list does not show jpe. Installation did not complete."; fi
if [ -f "$CLI" ]; then
  if node "$CLI" doctor | sed 's/^/  /'; then say "  Doctor finished without failures."; else say "  Doctor reported problems (see above). Fix them or roll back with uninstall.sh."; exit 1; fi
fi
say ""
say "Done. Restart Claude Code (or run /reload-plugins), then type /jpe."
