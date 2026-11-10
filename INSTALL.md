# Install Omni Voice Desk

## Easiest: download a release

1. Open **[Latest release](https://github.com/labKnowledge/omni-voice-desk/releases/latest)**.
2. Download the asset for your OS (see table in the [README](./README.md#download) or [RELEASE_NOTES.md](./RELEASE_NOTES.md)).
3. Follow the short steps for your platform below.

## Rebuild packages into `dist/` (gitignored)

```bash
npm run packages -- --mac
npm run packages -- --win
npm run packages -- --linux
npm run packages -- --all
```

Publish those files as a GitHub Release (updates download links):

```bash
bash scripts/publish-github-release.sh
```

## macOS

| Chip | Package |
|------|---------|
| Apple Silicon | `OmniVoiceDesk-*-mac-arm64.dmg` |
| Intel | `OmniVoiceDesk-*-mac-x64.dmg` |

Open the DMG → drag to **Applications** → first launch: **Right-click → Open**.

```bash
npm run install:mac
```

## Windows

Use `OmniVoiceDesk-*-win-x64.zip` or `*-win-arm64.zip`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

Or unzip and run `Omni Voice Desk.exe`. Unsigned builds may need SmartScreen → **More info → Run anyway**.

## Linux

Pick the package that matches your CPU (`uname -m`):

| Machine | Package suffix |
|---------|----------------|
| `x86_64` / Intel / AMD | `*-linux-amd64.deb` or `*-linux-x86_64.AppImage` |
| `aarch64` / ARM64 | `*-linux-arm64.deb` or `*-linux-arm64.AppImage` |

```bash
# AppImage (needs FUSE: apt install libfuse2t64 on Ubuntu 24.04)
chmod +x OmniVoiceDesk-*-linux-x86_64.AppImage   # or *-arm64.AppImage
./OmniVoiceDesk-*-linux-x86_64.AppImage

# Debian / Ubuntu — use the matching arch, not a glob of both
sudo dpkg -i OmniVoiceDesk-*-linux-amd64.deb     # or *-linux-arm64.deb
sudo apt -f install   # pulls deps like libsecret if needed

# Helper (auto-picks host arch from dist/)
npm run install:linux
```

## From source

```bash
npm install && npm start
```
