# MatchFrame

MatchFrame is a Windows desktop CS2 demo viewer and analysis workstation.

## v0.1.0 goals

- Open Counter-Strike 2 `.dem` files.
- Read map/player/round information and build a seekable match timeline.
- Launch the selected demo in CS2 for real first-person POV playback.
- Toggle a MatchFrame developer console with the physical `~` / Backquote key.
- Send common CS2 demo/spectator/HUD commands from MatchFrame.
- Keep the architecture ready for deeper aim, entry, trade, utility, positioning and economy analysis.

## Architecture

- **Electron 44** — desktop UI and renderer isolation.
- **Rust** — native core, IPC and orchestration.
- **C++** — Windows / CS2 process and console bridge.
- **Ruby** — analytics rule engine.
- **x86-64 Assembly (NASM)** — hot-path native helper routines.
- **demoparser2** — current CS2 demo decoding adapter; isolated so it can be replaced/fallbacked when Valve demo formats change.

## Development

```powershell
npm install
npm run build:backend
npm start
```

## Windows build

```powershell
npm run build:backend
npm run dist
```

Every push to `main` is built on GitHub Actions. The workflow publishes both the portable EXE and installer EXE into a unique GitHub Release.

## Status

This is the first functional development build. The built-in renderer currently focuses on match metadata, player selection and timeline control; full reconstructed 2D/3D world rendering and deep automatic coaching are next milestones.
