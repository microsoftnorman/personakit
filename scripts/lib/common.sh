#!/usr/bin/env bash
# Personakit shared dependency / environment helpers (POSIX).
# Sourced by install.sh, update.sh, and doctor.sh.

# ─── Pretty output ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  PK_C_RESET="\033[0m"
  PK_C_BOLD="\033[1m"
  PK_C_RED="\033[31m"
  PK_C_GREEN="\033[32m"
  PK_C_YELLOW="\033[33m"
  PK_C_CYAN="\033[36m"
  PK_C_DIM="\033[2m"
else
  PK_C_RESET=""; PK_C_BOLD=""; PK_C_RED=""; PK_C_GREEN=""
  PK_C_YELLOW=""; PK_C_CYAN=""; PK_C_DIM=""
fi

pk_bold() { printf "${PK_C_BOLD}%s${PK_C_RESET}\n" "$*"; }
pk_info() { printf "  ${PK_C_CYAN}▸${PK_C_RESET} %s\n" "$*"; }
pk_ok()   { printf "  ${PK_C_GREEN}✓${PK_C_RESET} %s\n" "$*"; }
pk_warn() { printf "  ${PK_C_YELLOW}!${PK_C_RESET} %s\n" "$*"; }
pk_err()  { printf "  ${PK_C_RED}✗${PK_C_RESET} %s\n" "$*" >&2; }
pk_dim()  { printf "    ${PK_C_DIM}%s${PK_C_RESET}\n" "$*"; }

# ─── OS / package-manager detection ─────────────────────────────────────────
pk_detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "macos" ;;
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

pk_detect_pkg_manager() {
  case "$(pk_detect_os)" in
    macos)
      if command -v brew >/dev/null 2>&1; then echo "brew"
      else echo "none-brew"; fi
      ;;
    linux|wsl)
      if   command -v apt-get >/dev/null 2>&1; then echo "apt"
      elif command -v dnf     >/dev/null 2>&1; then echo "dnf"
      elif command -v yum     >/dev/null 2>&1; then echo "yum"
      elif command -v pacman  >/dev/null 2>&1; then echo "pacman"
      elif command -v zypper  >/dev/null 2>&1; then echo "zypper"
      elif command -v apk     >/dev/null 2>&1; then echo "apk"
      else echo "unknown"; fi
      ;;
    *) echo "unknown" ;;
  esac
}

# Print OS-aware install hint for a missing tool.
# Args: $1 = tool name (git | node | npm)
pk_install_hint() {
  local tool="$1"
  local pm; pm="$(pk_detect_pkg_manager)"
  case "$tool:$pm" in
    git:brew)        echo "brew install git" ;;
    git:none-brew)   echo "Install Homebrew from https://brew.sh, then: brew install git" ;;
    git:apt)         echo "sudo apt-get update && sudo apt-get install -y git" ;;
    git:dnf)         echo "sudo dnf install -y git" ;;
    git:yum)         echo "sudo yum install -y git" ;;
    git:pacman)      echo "sudo pacman -S --noconfirm git" ;;
    git:zypper)      echo "sudo zypper install -y git" ;;
    git:apk)         echo "sudo apk add git" ;;
    git:*)           echo "Install Git from https://git-scm.com/downloads" ;;

    node:brew)       echo "brew install node@20" ;;
    node:none-brew)  echo "Install via https://nodejs.org/ (LTS) or nvm: https://github.com/nvm-sh/nvm" ;;
    node:apt)        echo "Use NodeSource: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
    node:dnf|node:yum) echo "Use NodeSource: curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo $pm install -y nodejs" ;;
    node:pacman)     echo "sudo pacman -S --noconfirm nodejs npm" ;;
    node:zypper)     echo "sudo zypper install -y nodejs20 npm20" ;;
    node:apk)        echo "sudo apk add nodejs npm" ;;
    node:*)          echo "Install Node.js 18+ from https://nodejs.org/ or use nvm: https://github.com/nvm-sh/nvm" ;;

    npm:*)           echo "npm ships with Node.js — installing Node will install npm." ;;

    *)               echo "Install $tool manually." ;;
  esac
}

# Compare semver-ish strings: returns 0 if $1 >= $2.
pk_version_ge() {
  # Strip leading 'v', take first 3 dotted numeric components.
  local a b
  a="$(echo "${1#v}" | awk -F. '{printf "%d.%d.%d", $1, $2, $3}')"
  b="$(echo "${2#v}" | awk -F. '{printf "%d.%d.%d", $1, $2, $3}')"
  [ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n1)" = "$b" ]
}

# Check a single dependency. Args: cmd-name, min-version (or empty), version-flag
# Returns 0 = OK; 1 = missing; 2 = too old.
# Side-effects: writes status lines to stdout.
pk_check_dep() {
  local cmd="$1"; local min="${2:-}"; local flag="${3:--v}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    pk_err "$cmd: not found"
    pk_dim "Install: $(pk_install_hint "$cmd")"
    return 1
  fi
  if [ -n "$min" ]; then
    local raw ver
    raw="$("$cmd" "$flag" 2>&1 | head -n1)"
    # Extract first dotted numeric token.
    ver="$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1)"
    if [ -z "$ver" ]; then
      pk_warn "$cmd: present (version unknown)"
      return 0
    fi
    if pk_version_ge "$ver" "$min"; then
      pk_ok "$cmd $ver"
      return 0
    fi
    pk_err "$cmd $ver — need >= $min"
    pk_dim "Upgrade: $(pk_install_hint "$cmd")"
    return 2
  fi
  pk_ok "$cmd present"
  return 0
}

# Check the LLM credential (informational only — not required).
# Personakit prefers MCP host sampling: when running inside VS Code + Copilot
# Chat the host supplies the LLM and no token is required. Env-var tokens
# (GITHUB_MODELS_TOKEN / GH_TOKEN / GITHUB_TOKEN) are an optional fallback
# for hosts without sampling (e.g. Copilot CLI today).
pk_check_llm_credential() {
  if [ -n "${GITHUB_MODELS_TOKEN:-}" ]; then
    pk_ok "Fallback token set: GITHUB_MODELS_TOKEN"
  elif [ -n "${GH_TOKEN:-}" ]; then
    pk_ok "Fallback token set: GH_TOKEN (Copilot CLI session)"
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    pk_ok "Fallback token set: GITHUB_TOKEN"
  else
    pk_info "No env-var token set — Personakit will use MCP host sampling (recommended)."
    pk_dim "In VS Code + Copilot Chat this is the default and requires no setup."
    pk_dim "Only set a token when running outside a sampling-capable host (e.g. Copilot CLI):"
    pk_dim "  export GITHUB_MODELS_TOKEN=<your token>      # preferred"
    pk_dim "  export GH_TOKEN=<your token>                 # Copilot CLI session token"
    pk_dim "  export GITHUB_TOKEN=<your token>             # generic GitHub token"
  fi
}

# Run all required dep checks. Sets PK_DEPS_OK=1 on success.
pk_check_all_deps() {
  PK_DEPS_OK=1
  local rc
  pk_check_dep git  ""    --version || PK_DEPS_OK=0
  pk_check_dep node 18.0.0 -v       || PK_DEPS_OK=0
  pk_check_dep npm  ""    -v        || PK_DEPS_OK=0
  if [ "$PK_DEPS_OK" -eq 0 ]; then
    return 1
  fi
  return 0
}
