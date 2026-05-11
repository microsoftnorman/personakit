#!/usr/bin/env bash
# Personakit one-line installer (POSIX — macOS / Linux / WSL).
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash
#
# Downloads a GitHub source archive over HTTP, extracts it into
# ./.personakit-plugin/, builds the MCP server, and registers
# .vscode/mcp.json. No `git` dependency.
#
# Env vars (all optional):
#   PERSONAKIT_DIR          Target dir for the install. Default: ./.personakit-plugin
#   PERSONAKIT_REF          Branch / tag / SHA. Default: main
#   PERSONAKIT_ARCHIVE_URL  Direct override for the archive URL (used by tests
#                           and self-hosted mirrors). When unset, the URL is
#                           derived as
#                           https://codeload.github.com/microsoftnorman/personakit/tar.gz/<ref>.
#   PERSONAKIT_NO_VSCODE    Set to "1" to skip writing .vscode/mcp.json.

set -euo pipefail

REPO_OWNER="microsoftnorman"
REPO_NAME="personakit"
TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
REF="${PERSONAKIT_REF:-main}"
DEFAULT_ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REF}"
ARCHIVE_URL="${PERSONAKIT_ARCHIVE_URL:-$DEFAULT_ARCHIVE_URL}"

# ─── Source shared lib ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  # shellcheck source=lib/common.sh
  . "$SCRIPT_DIR/lib/common.sh"
else
  COMMON_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REF}/scripts/lib/common.sh"
  COMMON_TMP="$(mktemp)"
  if ! curl -fsSL "$COMMON_URL" -o "$COMMON_TMP"; then
    echo "✗ Could not fetch shared lib from $COMMON_URL" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$COMMON_TMP"
  rm -f "$COMMON_TMP"
fi

# ─── Helpers (script-local) ─────────────────────────────────────────────────
pk_fetch_archive() {
  # $1 = url, $2 = dest path
  case "$1" in
    file://*)
      # Strip scheme; curl -o on file:// also works but Copy is portable.
      local local_path="${1#file://}"
      cp "$local_path" "$2"
      ;;
    *)
      curl -fsSL "$1" -o "$2"
      ;;
  esac
}

pk_looks_like_install() {
  [ -f "$1/.personakit-version" ] || [ -f "$1/packages/personakit-mcp/package.json" ]
}

pk_bold "Personakit installer"
echo
pk_info "Detected OS: $(pk_detect_os) (package manager: $(pk_detect_pkg_manager))"
echo

# ─── Dependency check (no git required) ─────────────────────────────────────
pk_bold "Checking dependencies"
if ! pk_check_all_deps; then
  echo
  pk_err "Dependency check failed. Install the missing tools above and re-run."
  exit 1
fi
echo

# ─── Download + extract ─────────────────────────────────────────────────────
pk_bold "Fetching source"
WORK_TMP="$(mktemp -d)"
trap 'rm -rf "$WORK_TMP"' EXIT
ARCHIVE="$WORK_TMP/archive.tar.gz"
EXTRACT_DIR="$WORK_TMP/extract"
mkdir -p "$EXTRACT_DIR"

pk_info "Downloading $ARCHIVE_URL"
pk_fetch_archive "$ARCHIVE_URL" "$ARCHIVE"
SIZE_KB="$(( $(wc -c < "$ARCHIVE") / 1024 ))"
pk_ok "Downloaded ${SIZE_KB} KB"

pk_info "Extracting…"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
EXTRACTED="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [ -z "$EXTRACTED" ]; then
  pk_err "Archive did not contain a top-level folder."
  exit 1
fi

# Resolve target to an absolute path so the move is predictable.
case "$TARGET_DIR" in
  /*) ABS_TARGET="$TARGET_DIR" ;;
  *)  ABS_TARGET="$(pwd)/${TARGET_DIR#./}" ;;
esac
PARENT_DIR="$(dirname "$ABS_TARGET")"
mkdir -p "$PARENT_DIR"

if [ -e "$ABS_TARGET" ]; then
  if ! pk_looks_like_install "$ABS_TARGET"; then
    pk_err "Refusing to overwrite $ABS_TARGET — it doesn't look like a previous Personakit install."
    pk_dim "Move or delete it manually, or set PERSONAKIT_DIR to a different path."
    exit 1
  fi
  pk_info "Replacing existing install at $ABS_TARGET"
  rm -rf "$ABS_TARGET"
fi
mv "$EXTRACTED" "$ABS_TARGET"

# Stamp version file.
INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"ref":"%s","archive_url":"%s","installed":"%s"}\n' \
  "$REF" "$ARCHIVE_URL" "$INSTALLED_AT" \
  > "$ABS_TARGET/.personakit-version"

pk_ok "Installed to $ABS_TARGET"
echo

# ─── Install + build ────────────────────────────────────────────────────────
pk_bold "Installing & building"
pk_info "npm install (this may take a minute)…"
( cd "$TARGET_DIR" && npm install --silent --no-audit --no-fund )
pk_ok "Dependencies installed"

pk_info "Building personakit-mcp"
( cd "$TARGET_DIR" && npm run --silent build -w personakit-mcp )
pk_ok "Built"
echo

# ─── Write .vscode/mcp.json ────────────────────────────────────────────────
pk_bold "Editor configuration"
if [ "${PERSONAKIT_NO_VSCODE:-0}" = "1" ]; then
  pk_info "Skipping .vscode/mcp.json (PERSONAKIT_NO_VSCODE=1)"
else
  mkdir -p .vscode
  if [ -e .vscode/mcp.json ]; then
    pk_warn ".vscode/mcp.json already exists — leaving it alone."
    pk_dim "Merge this entry manually under \"servers\":"
    cat <<JSON

      "personakit": {
        "type": "stdio",
        "command": "node",
        "args": ["$TARGET_DIR/packages/personakit-mcp/dist/index.js"],
        "env": {
          "PERSONAKIT_WORKSPACE_ROOT": "\${workspaceFolder}",
          "GITHUB_MODELS_TOKEN": "\${env:GITHUB_MODELS_TOKEN}",
          "GH_TOKEN": "\${env:GH_TOKEN}",
          "GITHUB_TOKEN": "\${env:GITHUB_TOKEN}"
        }
      }

JSON
  else
    cat > .vscode/mcp.json <<JSON
{
  "servers": {
    "personakit": {
      "type": "stdio",
      "command": "node",
      "args": ["$TARGET_DIR/packages/personakit-mcp/dist/index.js"],
      "env": {
        "PERSONAKIT_WORKSPACE_ROOT": "\${workspaceFolder}",
        "GITHUB_MODELS_TOKEN": "\${env:GITHUB_MODELS_TOKEN}",
        "GH_TOKEN": "\${env:GH_TOKEN}",
        "GITHUB_TOKEN": "\${env:GITHUB_TOKEN}"
      }
    }
  }
}
JSON
    pk_ok "Wrote .vscode/mcp.json"
  fi
fi
echo

# ─── LLM access check (informational) ──────────────────────────────────────
pk_bold "LLM access"
pk_check_llm_credential
echo

# ─── Done ──────────────────────────────────────────────────────────────────
pk_bold "Done."
echo
echo "  Next steps:"
echo "    1. Reload your editor (VS Code Insiders + Copilot Chat recommended)."
echo "       No token setup required — Personakit uses MCP host sampling."
echo
echo "    2. In Copilot Chat, try:"
echo "         \"Generate 5 synthetic personas for <your product brief>.\""
echo "       (VS Code will prompt you to allow the first sampling call.)"
echo
echo "    Optional: only set GITHUB_MODELS_TOKEN / GH_TOKEN / GITHUB_TOKEN"
echo "    when running outside a sampling-capable host (e.g. Copilot CLI)."
echo
echo "  Plugin location:    $TARGET_DIR"
echo "  Skills + agents:    $TARGET_DIR/plugins/personakit/"
echo "  Reference example:  $TARGET_DIR/examples/saas-project-management-tool/"
echo
echo "  To update later:"
echo "    curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.sh | bash"
echo
echo "  To run a health check:"
echo "    curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.sh | bash"
echo
