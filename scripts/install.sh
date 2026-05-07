#!/usr/bin/env bash
# Personakit one-line installer (POSIX).
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash
#
# What this does:
#   1. Clones microsoftnorman/personakit into ./.personakit-plugin/ in the
#      current directory (or PERSONAKIT_DIR if set).
#   2. Runs `npm install` and builds the MCP server.
#   3. Writes a `.vscode/mcp.json` in the current directory registering
#      personakit (won't overwrite an existing one — merges manually if needed).
#   4. Prints next steps.
#
# Env vars (all optional):
#   PERSONAKIT_DIR    Target dir for the clone. Default: ./.personakit-plugin
#   PERSONAKIT_REF    Git ref to check out. Default: main
#   PERSONAKIT_NO_VSCODE   Set to "1" to skip writing .vscode/mcp.json

set -euo pipefail

REPO_URL="https://github.com/microsoftnorman/personakit.git"
TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
GIT_REF="${PERSONAKIT_REF:-main}"

bold()   { printf "\033[1m%s\033[0m\n" "$*"; }
info()   { printf "  \033[36m%s\033[0m %s\n" "▸" "$*"; }
ok()     { printf "  \033[32m%s\033[0m %s\n" "✓" "$*"; }
warn()   { printf "  \033[33m%s\033[0m %s\n" "!" "$*"; }
fail()   { printf "  \033[31m%s\033[0m %s\n" "✗" "$*" >&2; exit 1; }

bold "Personakit installer"
echo

# ─── Prereq checks ──────────────────────────────────────────────────────────
command -v git  >/dev/null 2>&1 || fail "git is required (not found in PATH)"
command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required (not found in PATH)"
command -v npm  >/dev/null 2>&1 || fail "npm is required (not found in PATH)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18+ required (have $(node -v))"
fi
ok  "Prerequisites OK (node $(node -v), git $(git --version | awk '{print $3}'))"

# ─── Clone or update ────────────────────────────────────────────────────────
if [ -d "$TARGET_DIR/.git" ]; then
  info "Updating existing clone at $TARGET_DIR"
  git -C "$TARGET_DIR" fetch --quiet origin "$GIT_REF"
  git -C "$TARGET_DIR" checkout --quiet "$GIT_REF"
  git -C "$TARGET_DIR" pull --ff-only --quiet origin "$GIT_REF"
  ok  "Updated to latest $GIT_REF"
else
  info "Cloning $REPO_URL into $TARGET_DIR"
  git clone --quiet --branch "$GIT_REF" --depth 1 "$REPO_URL" "$TARGET_DIR"
  ok  "Cloned"
fi

# ─── Install + build ────────────────────────────────────────────────────────
info "Installing dependencies (this may take a minute)…"
( cd "$TARGET_DIR" && npm install --silent --no-audit --no-fund )
ok  "Dependencies installed"

info "Building personakit-mcp"
( cd "$TARGET_DIR" && npm run --silent build -w personakit-mcp )
ok  "Built"

# ─── Write .vscode/mcp.json ────────────────────────────────────────────────
if [ "${PERSONAKIT_NO_VSCODE:-0}" != "1" ]; then
  mkdir -p .vscode
  if [ -e .vscode/mcp.json ]; then
    warn ".vscode/mcp.json already exists — leaving it alone."
    warn "Merge this entry manually under \"servers\":"
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
    ok  "Wrote .vscode/mcp.json"
  fi
fi

echo
bold "Done."
echo
echo "  Next steps:"
echo "    1. Set an LLM credential. Personakit auto-detects, in order:"
echo "         GITHUB_MODELS_TOKEN  (recommended for Copilot users)"
echo "         OPENAI_API_KEY"
echo "         ANTHROPIC_API_KEY"
echo
echo "       Example: export GITHUB_MODELS_TOKEN=<your token>"
echo
echo "    2. Reload your editor (VS Code Insiders + Copilot Chat recommended)."
echo
echo "    3. In Copilot Chat, try:"
echo "         \"Generate 5 synthetic personas for <your product brief>.\""
echo
echo "  Plugin location: $TARGET_DIR"
echo "  Skills + agents: $TARGET_DIR/plugins/personakit/"
echo "  Reference example: $TARGET_DIR/examples/saas-project-management-tool/"
echo
