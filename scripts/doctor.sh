#!/usr/bin/env bash
# Personakit health check (POSIX) — read-only.
#
#   curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.sh | bash
#
# Reports on:
#   - Dependencies (node 18+, npm)
#   - LLM access (MCP sampling preferred; env tokens optional fallback)
#   - Install state (path, recorded ref + install timestamp)
#   - Build output (dist/index.js present)
#   - .vscode/mcp.json registration
#   - .personakit/ sandbox stats
#
# Env vars:
#   PERSONAKIT_DIR   Default: ./.personakit-plugin
#   PERSONAKIT_REF   Default: main

set -euo pipefail

TARGET_DIR="${PERSONAKIT_DIR:-./.personakit-plugin}"
REF="${PERSONAKIT_REF:-main}"
SANDBOX_DIR="${PERSONAKIT_SANDBOX:-./.personakit}"

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

ISSUES=0

pk_bold "Personakit doctor"
echo
pk_info "OS: $(pk_detect_os) (package manager: $(pk_detect_pkg_manager))"
echo

# ─── 1. Dependencies ───────────────────────────────────────────────────────
pk_bold "1. Dependencies"
if ! pk_check_all_deps; then ISSUES=$((ISSUES+1)); fi
echo

# ─── 2. LLM access ─────────────────────────────────────────────────────────
pk_bold "2. LLM access (MCP sampling preferred; env tokens are optional fallback)"
pk_check_llm_credential
echo

# ─── 3. Install state ──────────────────────────────────────────────────────
pk_bold "3. Install state"
VER_FILE="$TARGET_DIR/.personakit-version"
if [ ! -d "$TARGET_DIR" ]; then
  pk_err "No install at $TARGET_DIR"
  pk_dim "Install with: curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash"
  ISSUES=$((ISSUES+1))
elif [ -f "$VER_FILE" ]; then
  CUR_REF="$(grep -oE '"ref":"[^"]+"' "$VER_FILE" | head -n1 | cut -d'"' -f4 || echo '')"
  CUR_INSTALLED="$(grep -oE '"installed":"[^"]+"' "$VER_FILE" | head -n1 | cut -d'"' -f4 || echo '')"
  CUR_URL="$(grep -oE '"archive_url":"[^"]+"' "$VER_FILE" | head -n1 | cut -d'"' -f4 || echo '')"
  pk_ok "Install: $TARGET_DIR"
  pk_dim "Ref: $CUR_REF"
  pk_dim "Installed: $CUR_INSTALLED"
  pk_dim "Source: $CUR_URL"
else
  pk_warn "Install: $TARGET_DIR (no .personakit-version stamp — installed by an older script?)"
fi
echo

# ─── 4. Build output ───────────────────────────────────────────────────────
pk_bold "4. MCP server build"
DIST="$TARGET_DIR/packages/personakit-mcp/dist/index.js"
if [ -f "$DIST" ]; then
  pk_ok "Build present: $DIST"
else
  pk_err "Build output missing: $DIST"
  pk_dim "Build with: ( cd $TARGET_DIR && npm install && npm run build -w personakit-mcp )"
  ISSUES=$((ISSUES+1))
fi
echo

# ─── 5. Editor configuration ───────────────────────────────────────────────
pk_bold "5. Editor configuration"
if [ -f .vscode/mcp.json ]; then
  if grep -q '"personakit"' .vscode/mcp.json 2>/dev/null; then
    pk_ok ".vscode/mcp.json registers personakit"
  else
    pk_warn ".vscode/mcp.json exists but does not mention personakit"
    pk_dim "Re-run install to add the entry, or merge it manually."
  fi
else
  pk_warn ".vscode/mcp.json not found"
  pk_dim "Re-run install or write it manually (snippet in install output)."
fi
echo

# ─── 6. Sandbox stats ──────────────────────────────────────────────────────
pk_bold "6. .personakit/ sandbox"
if [ -d "$SANDBOX_DIR" ]; then
  pk_ok "Sandbox: $SANDBOX_DIR"
  count_in() {
    local sub="$1" pattern="$2"
    if [ -d "$SANDBOX_DIR/$sub" ]; then
      find "$SANDBOX_DIR/$sub" -type f -name "$pattern" 2>/dev/null | wc -l | tr -d ' '
    else
      echo 0
    fi
  }
  pk_dim "personas:    $(count_in personas '*.json')"
  pk_dim "agents:      $(count_in agents '*.agent.md')"
  pk_dim "research:    $(find "$SANDBOX_DIR/research" -type f 2>/dev/null | wc -l | tr -d ' ')"
  pk_dim "transcripts: $(count_in transcripts '*.md')"
  pk_dim "gtm plans:   $(count_in gtm '*-gtm.json')"
  pk_dim "audit days:  $(count_in audit '*.jsonl')"
else
  pk_dim "(none yet — created on first MCP call)"
fi
echo

# ─── Summary ───────────────────────────────────────────────────────────────
if [ "$ISSUES" -eq 0 ]; then
  pk_bold "All checks passed."
  exit 0
else
  pk_bold "$ISSUES issue(s) above."
  exit 1
fi
