#!/usr/bin/env bash
# Sign and optionally notarize macOS release binaries.
# Requires: APPLE_SIGNING_IDENTITY, and for notarization APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${ROOT}/dist/bin"

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "APPLE_SIGNING_IDENTITY not set — skipping codesign (expected in CI without secrets)."
  exit 0
fi

for bin in "${BIN_DIR}"/agent-todo-darwin-*; do
  [[ -f "$bin" ]] || continue
  echo "Signing $bin"
  codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$bin"
  codesign --verify --verbose "$bin"
done

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_TEAM_ID:-}" || -z "${APPLE_APP_PASSWORD:-}" ]]; then
  echo "Notarization credentials not set — skipping notarization."
  exit 0
fi

ZIP="${BIN_DIR}/agent-todo-macos.zip"
rm -f "$ZIP"
(cd "$BIN_DIR" && zip -q "$ZIP" agent-todo-darwin-arm64 agent-todo-darwin-x64 2>/dev/null || zip -q "$ZIP" agent-todo-darwin-*)

echo "Submitting for notarization..."
xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
xcrun stapler staple "$ZIP" || true
echo "Notarization complete."
