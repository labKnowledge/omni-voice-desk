#!/usr/bin/env bash
# Publish dist/ installers as a GitHub Release using RELEASE_NOTES.md.
# Prereqs: gh auth login, git remote origin, packages already in dist/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
NOTES="$ROOT/RELEASE_NOTES.md"
REPO_SLUG="${GITHUB_REPOSITORY:-labKnowledge/omni-voice-desk}"
LATEST_URL="https://github.com/${REPO_SLUG}/releases/latest"

if [[ ! -f "$NOTES" ]]; then
  echo "Missing $NOTES" >&2
  exit 1
fi

mapfile -t ASSETS < <(
  find "$ROOT/dist" -maxdepth 1 -type f \( \
    -name 'OmniVoiceDesk-*.dmg' -o \
    -name 'OmniVoiceDesk-*.zip' -o \
    -name 'OmniVoiceDesk-*.AppImage' -o \
    -name 'OmniVoiceDesk-*.deb' -o \
    -name 'OmniVoiceDesk-*-setup.exe' -o \
    -name 'OmniVoiceDesk-*-portable.exe' \
  \) | sort
)

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  echo "No installers in dist/. Build first:" >&2
  echo "  npm run packages -- --all" >&2
  exit 1
fi

echo "Publishing ${TAG} to ${REPO_SLUG}"
echo "Assets (${#ASSETS[@]}):"
printf '  %s\n' "${ASSETS[@]##*/}"
echo

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release ${TAG} already exists — uploading / replacing assets…"
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
  gh release edit "$TAG" --notes-file "$NOTES" --title "Omni Voice Desk ${TAG}"
else
  gh release create "$TAG" "${ASSETS[@]}" \
    --title "Omni Voice Desk ${TAG}" \
    --notes-file "$NOTES" \
    --latest
fi

echo
echo "Done. Downloads:"
echo "  ${LATEST_URL}"
echo "Direct asset pattern:"
echo "  https://github.com/${REPO_SLUG}/releases/download/${TAG}/OmniVoiceDesk-${VERSION}-<platform>"
