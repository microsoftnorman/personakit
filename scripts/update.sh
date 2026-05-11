#!/usr/bin/env bash
# Personakit updater (POSIX).
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.sh | bash
#
# Re-downloads the source archive over HTTP and reinstalls into the existing
# install directory. No `git` dependency.
#
# Env vars:
#   PERSONAKIT_DIR          Default: ./.personakit-plugin
#   PERSONAKIT_REF          Default: main
#   PERSONAKIT_ARCHIVE_URL  Override the archive URL
#   PERSONAKIT_FORCE        Set to "1" to reinstall even if .personakit-version
#                           already records the requested ref.

set -euo pipefail

TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
REF="${PERSONAKIT_REF:-main}"

# ─── Source shared lib ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  # shellcheck source=lib/common.sh
  . "$SCRIPT_DIR/lib/common.sh"
elif [ -d "$TARGET_DIR/scripts/lib" ]; then
  . "$TARGET_DIR/scripts/lib/common.sh"
else
  COMMON_URL="https://raw.githubusercontent.com/microsoftnorman/personakit/${REF}/scripts/lib/common.sh"
  COMMON_TMP="$(mktemp)"
  curl -fsSL "$COMMON_URL" -o "$COMMON_TMP"
  # shellcheck disable=SC1090
  . "$COMMON_TMP"
  rm -f "$COMMON_TMP"
fi

pk_bold "Personakit updater"
echo

VER_FILE="$TARGET_DIR/.personakit-version"
MCP_PKG="$TARGET_DIR/packages/personakit-mcp/package.json"
if [ ! -f "$VER_FILE" ] && [ ! -f "$MCP_PKG" ]; then
  pk_err "No Personakit install found at $TARGET_DIR."
  pk_dim "Run the installer first:"
  pk_dim "  curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash"
  exit 1
fi
pk_ok "Found install: $TARGET_DIR"

if [ -f "$VER_FILE" ]; then
  CURRENT_REF="$(grep -oE '"ref":"[^"]+"' "$VER_FILE" | head -n1 | cut -d'"' -f4 || echo '')"
  CURRENT_INSTALLED="$(grep -oE '"installed":"[^"]+"' "$VER_FILE" | head -n1 | cut -d'"' -f4 || echo '')"
  pk_dim "Current ref: $CURRENT_REF (installed $CURRENT_INSTALLED)"
  if [ "$CURRENT_REF" = "$REF" ] && [ "${PERSONAKIT_FORCE:-0}" != "1" ]; then
    pk_ok "Already on '$REF'."
    echo
    pk_dim "Set PERSONAKIT_FORCE=1 to re-download and rebuild anyway."
    exit 0
  fi
fi
echo

# ─── Re-run installer ───────────────────────────────────────────────────────
INSTALLER="$TARGET_DIR/scripts/install.sh"
if [ ! -f "$INSTALLER" ]; then
  pk_err "Installer script missing inside install dir: $INSTALLER"
  pk_dim "Reinstall from scratch:"
  pk_dim "  curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash"
  exit 1
fi

pk_info "Re-installing $TARGET_DIR from ref '$REF'…"
bash "$INSTALLER"
