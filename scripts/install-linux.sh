#!/usr/bin/env bash
# Install Omni Voice Desk on Linux from dist/ AppImage or .deb
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)
    deb_arch="amd64"
    appimage_arch="x86_64"
    ;;
  aarch64|arm64)
    deb_arch="arm64"
    appimage_arch="arm64"
    ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

# Newest matching artifact for this host arch (avoid ls|tail picking the wrong arch).
pick_artifact() {
  local pattern="$1"
  local match=""
  # shellcheck disable=SC2086
  match="$(ls -1t $pattern 2>/dev/null | head -1 || true)"
  echo "$match"
}

echo "Omni Voice Desk — Linux installer ($arch)"
echo

deb="$(pick_artifact "$DIST/OmniVoiceDesk-*-linux-${deb_arch}.deb")"
if [[ -z "$deb" ]]; then
  deb="$(pick_artifact "$DIST/Omni Voice Desk-*-linux-${deb_arch}.deb")"
fi

appimage="$(pick_artifact "$DIST/OmniVoiceDesk-*-linux-${appimage_arch}.AppImage")"
if [[ -z "$appimage" ]]; then
  appimage="$(pick_artifact "$DIST/Omni Voice Desk-*-linux-${appimage_arch}.AppImage")"
fi

if [[ -n "$deb" ]] && command -v dpkg >/dev/null 2>&1; then
  echo "Installing Debian package: $deb"
  if ! sudo dpkg -i "$deb"; then
    echo "Fixing dependencies…"
    sudo apt-get -f install -y
  fi
  echo
  echo "Launch from the app menu, or run: omni-voice-desk"
  exit 0
fi

if [[ -n "$appimage" ]]; then
  dest="${HOME}/.local/bin/Omni-Voice-Desk.AppImage"
  mkdir -p "$(dirname "$dest")"
  install -m 0755 "$appimage" "$dest"
  echo "Installed AppImage to: $dest"
  echo "Run: $dest"
  # AppImage needs libfuse2/libfuse2t64 on some distros (Ubuntu 22.04+/24.04).
  if ! command -v fusermount >/dev/null 2>&1 && ! command -v fusermount3 >/dev/null 2>&1; then
    echo "Note: if the AppImage fails to start, install FUSE (e.g. libfuse2t64)." >&2
  fi
  exec "$dest"
fi

echo "No Linux package for $arch found in dist/." >&2
echo "Expected one of:" >&2
echo "  OmniVoiceDesk-*-linux-${deb_arch}.deb" >&2
echo "  OmniVoiceDesk-*-linux-${appimage_arch}.AppImage" >&2
echo "Build with:" >&2
echo "  npm run packages -- --linux" >&2
exit 1
