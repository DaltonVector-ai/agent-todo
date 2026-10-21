#!/usr/bin/env sh
set -eu
(set -o pipefail 2>/dev/null) && set -o pipefail

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
agent-todo installer

Usage:
  install.sh [options] [-- <agent-todo install options>]

Environment variables:
  AGENT_TODO_INSTALL_DIR         Target directory for the binary (default: ~/.local/bin)
  AGENT_TODO_RELEASE_BASE_URL    Release download URL base
  NO_COLOR                       Disable colored terminal output

Examples:
  curl -fsSL https://raw.githubusercontent.com/DaltonVector-ai/agent-todo/main/scripts/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/DaltonVector-ai/agent-todo/main/scripts/install.sh | sh -s -- --local
  AGENT_TODO_INSTALL_DIR=/usr/local/bin ./scripts/install.sh
EOF
    exit 0
    ;;
esac

# Terminal styling (disabled if non-interactive or NO_COLOR is set)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  GREEN="\033[32m"
  CYAN="\033[36m"
  YELLOW="\033[33m"
  RED="\033[31m"
  RESET="\033[0m"
  CHECK="${GREEN}✓${RESET}"
else
  BOLD=""
  DIM=""
  GREEN=""
  CYAN=""
  YELLOW=""
  RED=""
  RESET=""
  CHECK="✓"
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64|armv8*|armv9*) ARCH="arm64" ;;
  *)
    printf "%bError:%b unsupported architecture: %s\n" "${RED}" "${RESET}" "$ARCH" >&2
    printf "agent-todo releases currently support x64 and arm64.\n" >&2
    exit 1
    ;;
esac

case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *)
    printf "%bError:%b unsupported operating system: %s\n" "${RED}" "${RESET}" "$OS" >&2
    printf "agent-todo installer supports macOS and Linux. For Windows, use install.ps1.\n" >&2
    exit 1
    ;;
esac

RELEASE_BASE_URL="${AGENT_TODO_RELEASE_BASE_URL:-https://github.com/DaltonVector-ai/agent-todo/releases/latest/download}"
RELEASE_BASE_URL="${RELEASE_BASE_URL%/}"

BIN_NAME="agent-todo-${OS}-${ARCH}"
URL="${RELEASE_BASE_URL}/${BIN_NAME}"

INSTALL_DIR="${AGENT_TODO_INSTALL_DIR:-$HOME/.local/bin}"
INSTALL_DIR="${INSTALL_DIR%/}"
TARGET_FILE="${INSTALL_DIR}/agent-todo"
TARGET_TMP="${TARGET_FILE}.tmp.$$"

# Clean path for display (replace $HOME with ~)
DISPLAY_TARGET="${TARGET_FILE}"
case "$DISPLAY_TARGET" in
  "$HOME"/*) DISPLAY_TARGET="~${DISPLAY_TARGET#"$HOME"}" ;;
esac

cleanup() {
  rm -f "$TARGET_TMP"
}
trap cleanup EXIT INT TERM HUP

printf "\n%bagent-todo installer%b\n\n" "${BOLD}" "${RESET}"
printf "  %bPlatform:%b    %s (%s)\n" "${DIM}" "${RESET}" "${OS}" "${ARCH}"
printf "  %bTarget:%b      %s\n" "${DIM}" "${RESET}" "${DISPLAY_TARGET}"
printf "  %bSource:%b      %s\n\n" "${DIM}" "${RESET}" "${URL}"

if ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
  printf "%bError:%b failed to create directory: %s\n" "${RED}" "${RESET}" "$INSTALL_DIR" >&2
  printf "Please check directory permissions or set AGENT_TODO_INSTALL_DIR.\n" >&2
  exit 1
fi

download() {
  _url="$1"
  _dest="$2"

  if command -v curl >/dev/null 2>&1; then
    if [ -t 2 ]; then
      curl -# -fL "$_url" -o "$_dest"
    else
      curl -sS -fL "$_url" -o "$_dest"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -t 2 ]; then
      wget --progress=bar:force -O "$_dest" "$_url"
    else
      wget -q --show-progress -O "$_dest" "$_url"
    fi
  else
    printf "%bError:%b curl or wget is required to download agent-todo.\n" "${RED}" "${RESET}" >&2
    exit 1
  fi
}

printf "  Downloading %s...\n" "${BIN_NAME}"
if ! download "$URL" "$TARGET_TMP"; then
  printf "\n%bError:%b failed to download agent-todo from:\n  %s\n" "${RED}" "${RESET}" "$URL" >&2
  printf "Please verify your internet connection or check the release URL.\n" >&2
  exit 1
fi

printf "\n  %b Download complete\n" "${CHECK}"

chmod +x "$TARGET_TMP"
if ! mv -f "$TARGET_TMP" "$TARGET_FILE"; then
  printf "%bError:%b failed to write binary to %s\n" "${RED}" "${RESET}" "$TARGET_FILE" >&2
  exit 1
fi

VERSION="$("$TARGET_FILE" --version 2>/dev/null || true)"
if [ -n "$VERSION" ]; then
  printf "  %b Installed %bagent-todo %s%b to %s\n\n" "${CHECK}" "${BOLD}" "${VERSION}" "${RESET}" "${DISPLAY_TARGET}"
else
  printf "  %b Installed %bagent-todo%b to %s\n\n" "${CHECK}" "${BOLD}" "${RESET}" "${DISPLAY_TARGET}"
fi

# Track whether INSTALL_DIR was already on PATH
WAS_ON_PATH=false
case ":$PATH:" in
  *:"$INSTALL_DIR":*|*:"$HOME/.local/bin":*|*:"~/.local/bin":*) WAS_ON_PATH=true ;;
esac

# Place binary on PATH for current session and any subprocesses
export PATH="$INSTALL_DIR:$PATH"

INSTALL_EXIT=0

# Trigger agent-todo install interactively every time so user can select options
if [ -t 0 ]; then
  # Direct terminal input (e.g. ./scripts/install.sh)
  "$TARGET_FILE" install "$@" || INSTALL_EXIT=$?
else
  # Piped to sh (curl ... | sh):
  # Duplicate stdout terminal (FD 1) into stdin so interactive prompts receive user input
  "$TARGET_FILE" install "$@" <&1 || INSTALL_EXIT=$?
fi

# If the directory was not originally in the user's permanent PATH, show reminder
if [ "$WAS_ON_PATH" = false ]; then
  SHELL_NAME="$(basename "${SHELL:-sh}")"
  PROFILE_FILE=""
  case "$SHELL_NAME" in
    zsh)
      PROFILE_FILE="~/.zshrc"
      ;;
    bash)
      if [ "$OS" = "darwin" ]; then
        PROFILE_FILE="~/.bash_profile"
      else
        PROFILE_FILE="~/.bashrc"
      fi
      ;;
    fish)
      PROFILE_FILE="~/.config/fish/config.fish"
      ;;
    *)
      PROFILE_FILE="~/.profile"
      ;;
  esac

  printf "\n  %bNote:%b %s is not in your permanent PATH.\n" "${YELLOW}" "${RESET}" "${INSTALL_DIR}"
  if [ "$SHELL_NAME" = "fish" ]; then
    printf "  To make it permanent, run:\n"
    printf "    %bfish_add_path %s%b\n\n" "${CYAN}" "${INSTALL_DIR}" "${RESET}"
  else
    printf "  To make it permanent, add this line to %b%s%b:\n" "${BOLD}" "${PROFILE_FILE}" "${RESET}"
    printf "    %bexport PATH=\"%s:\$PATH\"%b\n\n" "${CYAN}" "${INSTALL_DIR}" "${RESET}"
  fi
fi

if [ "$INSTALL_EXIT" -ne 0 ]; then
  exit "$INSTALL_EXIT"
fi
