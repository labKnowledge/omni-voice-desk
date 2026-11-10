#!/usr/bin/env bash
# Build installable packages. Uses Docker (electronuserland/builder:wine)
# for Windows NSIS / Linux when the host cannot run those toolchains natively.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

targets="${*:-}"
if [[ -z "$targets" ]]; then
  case "$(uname -s)" in
    Darwin) targets="--mac" ;;
    Linux) targets="--linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) targets="--win" ;;
    *) targets="--mac" ;;
  esac
fi

echo "Building icons…"
node scripts/generate-icons.cjs

want_mac=0 want_win=0 want_linux=0
[[ " $targets " == *" --mac "* || " $targets " == *" --all "* ]] && want_mac=1
[[ " $targets " == *" --win "* || " $targets " == *" --all "* ]] && want_win=1
[[ " $targets " == *" --linux "* || " $targets " == *" --all "* ]] && want_linux=1

if [[ $want_mac -eq 1 ]]; then
  echo "› macOS packages"
  npx electron-builder --mac
fi

# Windows zip always works cross-platform; NSIS needs wine (Docker).
if [[ $want_win -eq 1 ]]; then
  echo "› Windows zip packages"
  npx electron-builder --win zip --x64 --arm64 || true
  if command -v docker >/dev/null 2>&1; then
    echo "› Windows NSIS/portable via Docker"
    docker run --rm \
      -e ELECTRON_CACHE=/root/.cache/electron \
      -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
      -v "$ROOT":/project \
      -v omni-electron-cache:/root/.cache/electron \
      -v omni-electron-builder-cache:/root/.cache/electron-builder \
      electronuserland/builder:wine \
      /bin/bash -lc 'cd /project && npx electron-builder --win nsis portable --x64' \
      || echo "NSIS build skipped/failed (Wine under qemu is unreliable on Apple Silicon). Zip packages remain valid."
  else
    echo "Docker not available — shipping Windows .zip only (see scripts/install-windows.ps1)."
  fi
fi

if [[ $want_linux -eq 1 ]]; then
  if [[ "$(uname -s)" == "Linux" ]]; then
    echo "› Linux packages (native)"
    npx electron-builder --linux
  elif command -v docker >/dev/null 2>&1; then
    echo "› Linux packages via Docker"
    docker run --rm \
      -e ELECTRON_CACHE=/root/.cache/electron \
      -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
      -v "$ROOT":/project \
      -v omni-electron-cache:/root/.cache/electron \
      -v omni-electron-builder-cache:/root/.cache/electron-builder \
      electronuserland/builder:wine \
      /bin/bash -lc 'cd /project && npx electron-builder --linux AppImage deb --x64'
  else
    echo "Docker required to build Linux packages on this host." >&2
    exit 1
  fi
fi

node -e '
const fs=require("fs"),path=require("path");
const dist=path.join(process.cwd(),"dist");
const exts=new Set([".dmg",".zip",".exe",".AppImage",".deb"]);
const files=fs.readdirSync(dist).filter(n=>exts.has(path.extname(n))).sort();
const lines=["Omni Voice Desk — packages ready",""];
for (const n of files) {
  const s=fs.statSync(path.join(dist,n)).size;
  // Drop tiny/corrupt setup stubs (< 5 MB)
  if (n.endsWith("-setup.exe") && s < 5*1024*1024) {
    fs.unlinkSync(path.join(dist,n));
    console.warn("removed incomplete", n);
    continue;
  }
  lines.push(`  - ${n}  (${(s/1024/1024).toFixed(1)} MB)`);
}
lines.push("","See INSTALL.md for install steps.");
fs.writeFileSync(path.join(dist,"INSTALL.txt"), lines.join("\n")+"\n");
console.log(lines.join("\n"));
'
