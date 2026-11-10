#!/usr/bin/env bash
# Install Omni Voice Desk on macOS from a built DMG or .app in dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
APP_NAME="OmniVoiceDesk.app"
# Display name remains "Omni Voice Desk"; folder may also be that on older builds.
DEST="/Applications/OmniVoiceDesk.app"
LEGACY_DEST="/Applications/Omni Voice Desk.app"

arch="$(uname -m)"
case "$arch" in
  arm64) prefer="arm64" ;;
  x86_64) prefer="x64" ;;
  *) prefer="arm64" ;;
esac

pick_dmg() {
  local match
  match="$(ls -1 "$DIST"/OmniVoiceDesk-*-mac-"$prefer".dmg 2>/dev/null | tail -1 || true)"
  if [[ -n "$match" ]]; then
    echo "$match"
    return
  fi
  match="$(ls -1 "$DIST"/Omni\ Voice\ Desk-*-mac-"$prefer".dmg 2>/dev/null | tail -1 || true)"
  if [[ -n "$match" ]]; then
    echo "$match"
    return
  fi
  ls -1 "$DIST"/OmniVoiceDesk-*-mac-*.dmg "$DIST"/Omni\ Voice\ Desk-*-mac-*.dmg 2>/dev/null | tail -1 || true
}

pick_app() {
  if [[ -d "$DIST/mac-$prefer/$APP_NAME" ]]; then
    echo "$DIST/mac-$prefer/$APP_NAME"
    return
  fi
  if [[ -d "$DIST/mac/$APP_NAME" ]]; then
    echo "$DIST/mac/$APP_NAME"
    return
  fi
  ls -d "$DIST"/mac-*/"$APP_NAME" 2>/dev/null | head -1 || true
}

echo "Omni Voice Desk — macOS installer"
echo

dmg="$(pick_dmg)"
app="$(pick_app)"

if [[ -n "$dmg" ]]; then
  echo "Using package: $dmg"
  mount="$(hdiutil attach -nobrowse -readonly "$dmg" | awk '/\/Volumes\//{print $3; exit}')"
  if [[ -z "${mount:-}" ]]; then
    echo "Failed to mount DMG." >&2
    exit 1
  fi
  trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true' EXIT
  src="$mount/$APP_NAME"
  if [[ ! -d "$src" ]]; then
    echo "DMG does not contain $APP_NAME" >&2
    exit 1
  fi
elif [[ -n "$app" ]]; then
  echo "Using unpacked app: $app"
  src="$app"
else
  echo "No installer found. Build one first:" >&2
  echo "  npm run dist:mac" >&2
  exit 1
fi

echo "Installing to $DEST"
rm -rf "$DEST" "$LEGACY_DEST"
ditto "$src" "$DEST"

# Clear quarantine so Gatekeeper does not block unsigned local builds.
xattr -cr "$DEST" 2>/dev/null || true

echo
echo "Installed: $DEST"
echo "Open with: open \"$DEST\""
echo "If macOS still blocks it: Right-click the app → Open → Open."
# Code-signing warning during build is expected without a Developer ID — app still runs.
open "$DEST"
