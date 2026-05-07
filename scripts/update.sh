#!/usr/bin/env bash
# Personakit updater (POSIX).
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.sh | bash
#
# What this does:
#   1. Locates an existing Personakit clone (./.personakit-plugin/ or
#      $PERSONAKIT_DIR).
#   2. Compares the local commit SHA with origin/<ref>.
#   3. If behind: pulls, runs `npm install`, rebuilds the MCP server.
#   4. If up-to-date: prints status and exits.
#
# Env vars:
#   PERSONAKIT_DIR   Default: ./.personakit-plugin
#   PERSONAKIT_REF   Default: main
#   PERSONAKIT_FORCE Set to "1" to rebuild even when already up-to-date.

set -euo pipefail

TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
GIT_REF="${PERSONAKIT_REF:-main}"

# ─── Source shared lib ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  # shellcheck source=lib/common.sh
  . "$SCRIPT_DIR/lib/common.sh"
elif [ -d "$TARGET_DIR/scripts/lib" ]; then
  . "$TARGET_DIR/scripts/lib/common.sh"
else
  COMMON_URL="https://raw.githubusercontent.com/microsoftnorman/personakit/${GIT_REF}/scripts/lib/common.sh"
  COMMON_TMP="$(mktemp)"
  curl -fsSL "$COMMON_URL" -o "$COMMON_TMP"
  # shellcheck disable=SC1090
  . "$COMMON_TMP"
  rm -f "$COMMON_TMP"
fi

pk_bold "Personakit updater"
echo

if [ ! -d "$TARGET_DIR/.git" ]; then
  pk_err "No Personakit clone found at $TARGET_DIR."
  pk_dim "Run the installer first:"
  pk_dim "  curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash"
  exit 1
fi
pk_ok "Found clone: $TARGET_DIR"

# ─── Quick dep check (re-running install would re-check anyway) ─────────────
pk_info "Verifying dependencies"
if ! pk_check_all_deps; then
  pk_err "Dependency check failed. Resolve the above and re-run."
  exit 1
fi
echo

# ─── Compare local vs remote ───────────────────────────────────────────────
pk_bold "Checking for updates"
git -C "$TARGET_DIR" fetch --quiet origin "$GIT_REF"
LOCAL="$(git -C "$TARGET_DIR" rev-parse HEAD)"
REMOTE="$(git -C "$TARGET_DIR" rev-parse "origin/$GIT_REF")"
SHORT_LOCAL="${LOCAL:0:7}"
SHORT_REMOTE="${REMOTE:0:7}"

if [ "$LOCAL" = "$REMOTE" ]; then
  pk_ok "Already up-to-date ($SHORT_LOCAL on $GIT_REF)."
  if [ "${PERSONAKIT_FORCE:-0}" != "1" ]; then
    echo
    pk_dim "Set PERSONAKIT_FORCE=1 to rebuild anyway."
    exit 0
  fi
  pk_info "PERSONAKIT_FORCE=1 — rebuilding anyway."
else
  COMMITS_BEHIND="$(git -C "$TARGET_DIR" rev-list --count "$LOCAL..$REMOTE")"
  pk_info "Local:  $SHORT_LOCAL"
  pk_info "Remote: $SHORT_REMOTE ($COMMITS_BEHIND commit(s) ahead)"
  pk_info "Recent changes:"
  git -C "$TARGET_DIR" log --oneline --no-decorate -n 10 "$LOCAL..$REMOTE" | sed 's/^/    /'
  echo

  pk_info "Pulling…"
  git -C "$TARGET_DIR" checkout --quiet "$GIT_REF"
  git -C "$TARGET_DIR" pull --ff-only --quiet origin "$GIT_REF"
  pk_ok "Updated to $SHORT_REMOTE"
fi
echo

# ─── Reinstall + rebuild ───────────────────────────────────────────────────
pk_bold "Reinstalling & rebuilding"
pk_info "npm install"
( cd "$TARGET_DIR" && npm install --silent --no-audit --no-fund )
pk_ok "Dependencies installed"

pk_info "Building personakit-mcp"
( cd "$TARGET_DIR" && npm run --silent build -w personakit-mcp )
pk_ok "Built"
echo

pk_bold "Done."
pk_dim "Reload your editor to pick up the new MCP server build."
echo
