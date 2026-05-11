#!/usr/bin/env bash
# End-to-end test for scripts/install.sh.
#
# Runs fully offline by cloning the current working tree into a bare repo and
# pointing the installer at it via PERSONAKIT_REPO_URL.
#
# Usage:  bash scripts/tests/install.test.sh
# Requires: bash, git, node>=18, npm.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SH="$REPO_ROOT/scripts/install.sh"

if [ ! -f "$INSTALL_SH" ]; then
  echo "✗ install.sh not found at $INSTALL_SH" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }
assert_file()    { if [ -f "$1" ]; then pass "exists: $1"; else fail "missing: $1"; fi; }
assert_no_file() { if [ ! -e "$1" ]; then pass "absent: $1"; else fail "should be absent: $1"; fi; }
assert_grep()    { if grep -q "$2" "$1"; then pass "grep '$2' in $(basename "$1")"; else fail "grep '$2' missing in $1"; fi; }

# ─── Build a bare clone of the working tree (offline source) ────────────────
BARE="$TMP/repo.git"
git clone --quiet --bare "$REPO_ROOT" "$BARE"
GIT_REF="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
[ "$GIT_REF" = "HEAD" ] && GIT_REF="main"

run_installer() {
  # $1 = workspace dir, remaining args = extra env assignments (KEY=VAL)
  local ws="$1"; shift
  ( cd "$ws" \
    && PERSONAKIT_REPO_URL="file://$BARE" \
       PERSONAKIT_REF="$GIT_REF" \
       PERSONAKIT_DIR="./.personakit-plugin" \
       env "$@" bash "$INSTALL_SH" )
}

echo "── Test 1: fresh install"
WS1="$TMP/fresh"; mkdir -p "$WS1"
if run_installer "$WS1" >"$TMP/t1.log" 2>&1; then
  pass "exit 0"
else
  fail "installer exited non-zero"
  cat "$TMP/t1.log" >&2
fi
assert_file "$WS1/.personakit-plugin/.git/HEAD"
assert_file "$WS1/.personakit-plugin/packages/personakit-mcp/dist/index.js"
assert_file "$WS1/.vscode/mcp.json"
assert_grep "$WS1/.vscode/mcp.json" '"personakit"'
assert_grep "$WS1/.vscode/mcp.json" 'personakit-mcp/dist/index.js'

echo "── Test 2: re-run is idempotent"
if run_installer "$WS1" >"$TMP/t2.log" 2>&1; then
  pass "second run exit 0"
else
  fail "second run failed"
  cat "$TMP/t2.log" >&2
fi

echo "── Test 3: PERSONAKIT_NO_VSCODE=1 skips mcp.json"
WS3="$TMP/no-vscode"; mkdir -p "$WS3"
if run_installer "$WS3" PERSONAKIT_NO_VSCODE=1 >"$TMP/t3.log" 2>&1; then
  pass "exit 0"
else
  fail "installer failed"
  cat "$TMP/t3.log" >&2
fi
assert_no_file "$WS3/.vscode/mcp.json"

echo "── Test 4: preserves existing .vscode/mcp.json"
WS4="$TMP/existing"; mkdir -p "$WS4/.vscode"
ORIGINAL='{ "servers": { "other": { "command": "echo" } } }'
printf '%s' "$ORIGINAL" > "$WS4/.vscode/mcp.json"
if run_installer "$WS4" >"$TMP/t4.log" 2>&1; then
  pass "exit 0"
else
  fail "installer failed"
  cat "$TMP/t4.log" >&2
fi
ACTUAL="$(cat "$WS4/.vscode/mcp.json")"
if [ "$ACTUAL" = "$ORIGINAL" ]; then
  pass "existing mcp.json unchanged"
else
  fail "existing mcp.json was modified"
fi

echo
echo "── Summary: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
