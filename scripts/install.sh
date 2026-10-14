#!/usr/bin/env sh
set -euo pipefail

RELEASE_BASE_URL="${AGENT_TODO_RELEASE_BASE_URL:-https://github.com/DaltonVector-ai/agent-todo/releases/latest/download}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac
case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

BIN_NAME="agent-todo-${OS}-${ARCH}"
URL="${RELEASE_BASE_URL}/${BIN_NAME}"
INSTALL_DIR="${AGENT_TODO_INSTALL_DIR:-$HOME/.local/bin}"

mkdir -p "$INSTALL_DIR"
echo "Downloading ${URL} → ${INSTALL_DIR}/agent-todo"
curl -fsSL "$URL" -o "${INSTALL_DIR}/agent-todo"
chmod +x "${INSTALL_DIR}/agent-todo"

if ! command -v agent-todo >/dev/null 2>&1; then
  echo "Add ${INSTALL_DIR} to your PATH, then run: agent-todo install"
else
  agent-todo install || true
fi
