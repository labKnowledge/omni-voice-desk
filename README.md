# Omni Voice Desk

<p align="center">
  <img src="assets/icons/128x128.png" width="96" height="96" alt="Omni Voice Desk">
</p>

<p align="center">
  <a href="https://github.com/labKnowledge/omni-voice-desk/releases/latest"><img src="https://img.shields.io/github/v/release/labKnowledge/omni-voice-desk?label=download&style=flat-square" alt="Latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
</p>

**Hands-free desktop companion** powered by [LFM3-Omni-2B](https://huggingface.co/LiquidAI/LFM3-Omni-2B) on WebGPU. Speak naturally. Omni listens, talks back, picks a project folder, and can hand coding work to local agents on your machine.

Runs entirely on-device after the first model download. No cloud API key required for the voice model.

**[↓ Download latest release](https://github.com/labKnowledge/omni-voice-desk/releases/latest)** · [Install guide](./INSTALL.md) · [Release notes](./RELEASE_NOTES.md) · [Run from source](#run-from-source)

## Download

1. Open **[Releases → Latest](https://github.com/labKnowledge/omni-voice-desk/releases/latest)**.
2. Under **Assets**, grab the file for your OS (table below).
3. Install with the one-liners in that release’s notes (also in [RELEASE_NOTES.md](./RELEASE_NOTES.md)).

| Your machine | File to download |
|--------------|------------------|
| macOS Apple Silicon | `OmniVoiceDesk-*-mac-arm64.dmg` |
| macOS Intel | `OmniVoiceDesk-*-mac-x64.dmg` |
| Windows x64 | `OmniVoiceDesk-*-win-x64.zip` |
| Windows ARM64 | `OmniVoiceDesk-*-win-arm64.zip` |
| Linux x86_64 | `*-linux-amd64.deb` (preferred) or `*-linux-x86_64.AppImage` |
| Linux ARM64 | `*-linux-arm64.deb` or `*-linux-arm64.AppImage` |

Direct links for the current version (`v0.1.0`) are listed in **[RELEASE_NOTES.md](./RELEASE_NOTES.md)**. Prefer the **Latest** page so you always get the newest build.

### Quick install after download

```bash
# macOS — open the .dmg, drag to Applications, then Right-click → Open

# Windows — unzip, run "Omni Voice Desk.exe"
# (SmartScreen: More info → Run anyway)

# Linux .deb (x86_64 example — use arm64 package on ARM)
sudo dpkg -i OmniVoiceDesk-*-linux-amd64.deb && sudo apt -f install

# Linux AppImage
chmod +x OmniVoiceDesk-*-linux-x86_64.AppImage && ./OmniVoiceDesk-*-linux-x86_64.AppImage
```

Unsigned builds may need an extra click (Gatekeeper / SmartScreen). On Ubuntu 24.04, AppImages need FUSE (`sudo apt install libfuse2t64`).

More detail: **[INSTALL.md](./INSTALL.md)**.

## Why

Most voice UIs are demos. Omni Voice Desk is a desk you can leave open: continuous listening with mute and proximity gating, a swarm board for background jobs, and optional hooks into coding CLIs you already use (`cursor-agent`, `claude`, and friends).

## Features

- Local Omni model in Electron + WebGPU
- Continuous listening (VAD), mute, proximity gate, echo rejection
- Voice conductor with workspace tools for quick file work
- Background agents: CLIs on `PATH`, or the in-app `local-omni` worker
- Swarm panel for status, cancel, and clear
- Installers for macOS, Windows, and Linux

## Run from source

**Requirements:** Node 20+, a WebGPU-capable GPU.

```bash
npm install
npm start
```

```bash
npm run dev     # DevTools open
npm run clean   # wipe dist/ + caches
```

If Electron’s install script is blocked once:

```bash
npm install-scripts approve electron
npm run ensure-electron
```

First launch downloads model weights into the local Electron cache.

## Build & publish packages

```bash
npm run packages -- --mac
npm run packages -- --win
npm run packages -- --linux
npm run packages -- --all
```

Artifacts land in `dist/` (gitignored). To attach them to GitHub Releases (so the Download links above work):

```bash
bash scripts/publish-github-release.sh
```

That creates/updates tag `v$(package.json version)` with [RELEASE_NOTES.md](./RELEASE_NOTES.md) and every installer in `dist/`.

## Voice → agents

| Tool | Purpose |
|------|---------|
| `pick_workspace` / `set_workspace` | Project folder |
| `list_installed_agents` | CLIs on `PATH` |
| `spawn_coding_agent` | Delegate (`agent=auto` \| `cursor-agent` \| `claude` \| `local-omni`) |
| `list_agents` / `agent_status` | Progress |
| `cancel_agent` / `clear_agent_board` | Stop / clean |

Default `agent=auto` prefers an installed CLI, else local Omni.

## Privacy

- The Omni voice/text model runs locally via WebGPU.
- Agent CLIs you attach run as normal local processes on your machine.
- Harness state defaults to `~/.local/share/omni-voice-desk/` (override with `OMNI_DESK_HOME`).

## Layout

```
electron/     main process, branding, agent harness
renderer/     UI + Omni WebGPU runtime
assets/       app icon / tray (source: icon.png)
scripts/      icons, packages, install & release helpers
```

## Contributing

Issues and pull requests are welcome. Keep changes focused; match the existing style. For packaging bugs, include OS, CPU arch (`uname -m` / `dpkg --print-architecture`), and the exact artifact name you installed.

## Credits

Omni model: [LiquidAI / LFM3-Omni-2B](https://huggingface.co/LiquidAI/LFM3-Omni-2B). Desktop shell and agent harness are this project.

## License

[MIT](./LICENSE)
