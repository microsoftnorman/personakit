#!/usr/bin/env bash
# Personakit one-line installer (POSIX — macOS / Linux / WSL).
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash
#
# What this does:
#   1. Verifies dependencies (git, node 18+, npm) with OS-aware install hints.
#   2. Clones microsoftnorman/personakit into ./.personakit-plugin/
#      (or PERSONAKIT_DIR if set).
#   3. Runs `npm install` and builds the MCP server.
#   4. Writes a `.vscode/mcp.json` registering personakit (won't overwrite).
#   5. Prints next steps.
#
# Env vars (all optional):
#   PERSONAKIT_DIR         Target dir for the clone. Default: ./.personakit-plugin
#   PERSONAKIT_REF         Git ref to check out. Default: main
#   PERSONAKIT_NO_VSCODE   Set to "1" to skip writing .vscode/mcp.json

set -euo pipefail

REPO_URL="https://github.com/microsoftnorman/personakit.git"
TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
GIT_REF="${PERSONAKIT_REF:-main}"

# ─── Source shared lib ──────────────────────────────────────────────────────
# Two paths: (1) sourced from a local checkout at scripts/install.sh,
#            (2) piped from curl — fetch lib/common.sh from raw.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  # shellcheck source=lib/common.sh
  . "$SCRIPT_DIR/lib/common.sh"
else
  COMMON_URL="https://raw.githubusercontent.com/microsoftnorman/personakit/${GIT_REF}/scripts/lib/common.sh"
  COMMON_TMP="$(mktemp)"
  if ! curl -fsSL "$COMMON_URL" -o "$COMMON_TMP"; then
    echo "✗ Could not fetch shared lib from $COMMON_URL" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$COMMON_TMP"
  rm -f "$COMMON_TMP"
fi

pk_bold "Personakit installer"
echo
pk_info "Detected OS: $(pk_detect_os) (package manager: $(pk_detect_pkg_manager))"
echo

# ─── Dependency check ──────────────────────────────────────────────────────
pk_bold "Checking dependencies"
if ! pk_check_all_deps; then
  echo
  pk_err "Dependency check failed. Install the missing tools above and re-run."
  exit 1
fi
echo

# ─── Clone or update ────────────────────────────────────────────────────────
pk_bold "Fetching source"
if [ -d "$TARGET_DIR/.git" ]; then
  pk_info "Updating existing clone at $TARGET_DIR"
  git -C "$TARGET_DIR" fetch --quiet origin "$GIT_REF"
  git -C "$TARGET_DIR" checkout --quiet "$GIT_REF"
  git -C "$TARGET_DIR" pull --ff-only --quiet origin "$GIT_REF"
  pk_ok "Updated to latest $GIT_REF"
else
  pk_info "Cloning $REPO_URL into $TARGET_DIR"
  git clone --quiet --branch "$GIT_REF" --depth 1 "$REPO_URL" "$TARGET_DIR"
  pk_ok "Cloned"
fi
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
          "GITHUB_MODELS_TOKEN": "\${env:GITHUB_MODELS_TOKEN}"
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
        "GITHUB_MODELS_TOKEN": "\${env:GITHUB_MODELS_TOKEN}"
      }
    }
  }
}
JSON
    pk_ok "Wrote .vscode/mcp.json"
  fi
fi
echo

# ─── LLM credential check (warn-only) ──────────────────────────────────────
pk_bold "LLM credential"
pk_check_llm_credential
echo

# ─── Done ──────────────────────────────────────────────────────────────────
pk_bold "Done."
echo
echo "  Next steps:"
echo "    1. Set an LLM credential if you haven't yet:"
echo "         export GITHUB_MODELS_TOKEN=<your token>"
echo
echo "    2. Reload your editor (VS Code Insiders + Copilot Chat recommended)."
echo
echo "    3. In Copilot Chat, try:"
echo "         \"Generate 5 synthetic personas for <your product brief>.\""
echo
echo "  Plugin location:    $TARGET_DIR"
echo "  Skills + agents:    $TARGET_DIR/plugins/personakit/"
echo "  Reference example:  $TARGET_DIR/examples/saas-project-management-tool/"
echo
echo "  To check for updates later:"
echo "    curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.sh | bash"
echo
echo "  To run a health check:"
echo "    curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.sh | bash"
echo
