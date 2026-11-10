# Omni Voice Desk v0.1.0

First public release of the hands-free LFM3-Omni desktop companion.

## Download

Pick the file for your machine from the **Assets** list on this release (or use the direct links below after the release is published).

### macOS

| Chip | Download |
|------|----------|
| Apple Silicon (M1–M4) | [OmniVoiceDesk-0.1.0-mac-arm64.dmg](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-mac-arm64.dmg) |
| Intel | [OmniVoiceDesk-0.1.0-mac-x64.dmg](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-mac-x64.dmg) |

Open the DMG → drag to **Applications** → first launch: **Right-click → Open** (unsigned build).

### Windows

| Arch | Download |
|------|----------|
| x64 | [OmniVoiceDesk-0.1.0-win-x64.zip](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-win-x64.zip) |
| ARM64 | [OmniVoiceDesk-0.1.0-win-arm64.zip](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-win-arm64.zip) |

Unzip and run `Omni Voice Desk.exe`. If SmartScreen appears: **More info → Run anyway**.

### Linux

| Arch | Debian / Ubuntu | AppImage |
|------|-----------------|----------|
| x86_64 | [OmniVoiceDesk-0.1.0-linux-amd64.deb](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-linux-amd64.deb) | [OmniVoiceDesk-0.1.0-linux-x86_64.AppImage](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-linux-x86_64.AppImage) |
| ARM64 | [OmniVoiceDesk-0.1.0-linux-arm64.deb](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-linux-arm64.deb) | [OmniVoiceDesk-0.1.0-linux-arm64.AppImage](https://github.com/labKnowledge/omni-voice-desk/releases/download/v0.1.0/OmniVoiceDesk-0.1.0-linux-arm64.AppImage) |

```bash
# .deb (match amd64 or arm64 to your machine)
sudo dpkg -i OmniVoiceDesk-0.1.0-linux-amd64.deb
sudo apt -f install

# AppImage (Ubuntu 24.04: apt install libfuse2t64)
chmod +x OmniVoiceDesk-0.1.0-linux-x86_64.AppImage
./OmniVoiceDesk-0.1.0-linux-x86_64.AppImage
```

Check arch with `uname -m` (`x86_64` → amd64 / x86_64 packages; `aarch64` → arm64).

## What’s in this release

- Local LFM3-Omni voice desk on Electron + WebGPU
- Continuous listening with mute, proximity gate, and echo rejection
- Workspace tools and swarm board for background coding agents
- Hooks for installed CLIs (`cursor-agent`, `claude`, …) or in-app `local-omni`
- Installers for macOS, Windows, and Linux

## Notes

- First launch downloads model weights into the local Electron cache (needs network once).
- Requires a WebGPU-capable GPU.
- Builds are unsigned; OS warnings on first open are expected.

Full install guide: [INSTALL.md](https://github.com/labKnowledge/omni-voice-desk/blob/main/INSTALL.md)
