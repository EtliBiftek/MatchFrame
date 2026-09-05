# MatchFrame

MatchFrame is a Windows desktop CS2 demo viewer and analysis workstation.

## Current features

- Open Counter-Strike 2 `.dem` files and replay player movement on the real CS2 radar.
- Use a single time-based match timeline with selected-player kill/death markers.
- Jump one round backward/forward or select a round directly.
- View demo time as `MM:SS` instead of raw ticks.
- Offline first-person POV: MatchFrame reads the locally installed CS2 map VPK, converts the Source 2 map to a cached GLB, and renders the selected player's demo camera without starting `cs2.exe`.
- Demo voice: when a server-recorded demo contains voice data (for example many FACEIT/server demos), MatchFrame extracts a full-length synchronized WAV per player and exposes per-player voice toggles. Valve Matchmaking demos generally contain no voice data, so those buttons stay hidden.
- Optional `CS2'de aç` button for comparison with the original engine.
- Toggle the MatchFrame developer console with the physical `~` / Backquote key and send supported CS2 console commands when CS2 is running.

## Architecture

- **Electron 44** — desktop UI and renderer isolation.
- **Babylon.js** — local WebGL offline POV rendering.
- **Rust** — native core, IPC and orchestration.
- **C++** — Windows / CS2 process and console bridge.
- **Ruby** — analytics rule engine.
- **x86-64 Assembly (NASM)** — hot-path native helper routines.
- **demoparser2** — CS2 demo state/event decoding adapter.
- **Source 2 Viewer / ValveResourceFormat** — converts locally installed CS2 Source 2 map resources to glTF/GLB for offline POV. MatchFrame does not redistribute Valve map assets.
- **csgo-voice-extractor** — MIT-licensed CS2 demo voice extraction helper used in `split-full` mode so player audio stays aligned to the original demo timeline.

Powered by [Source 2 Viewer](https://s2v.app) ([ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)).

## Offline POV notes

The `.dem` file itself is not a video. Offline POV is reconstructed from the demo camera/player state plus the Source 2 map resources already installed with CS2. The first time a map is opened in Offline POV, MatchFrame downloads a pinned Source 2 Viewer CLI release, verifies its SHA-256, exports the map to the user cache, then reuses that cache on later launches. `cs2.exe` is not started for this mode.

## Analysis panels

The left rail switches between four screens:

- **Replay** — radar timeline, POV and voice (existing pipeline).
- **Analysis** — match summary: score/rounds, team comparison, player table (K/D/A, ADR,
  HS%, entry, trade, flash assist, clutch), round list and per-event jump back to replay.
- **Aim** — planned for stage 6 (`player_hurt` / `weapon_fire` / `bullet_impact` metrics).
- **Utility** — grenade usage preview now, full module in stage 5.

A single analysis model is built once per demo (`buildMatchModel`) and shared by all
screens. Missing parser data is reported explicitly instead of showing fabricated numbers.
See `docs/ANALYSIS-MODEL.md` and `docs/LEFT-PANEL-MODULES.md`.

## Development

```powershell
npm install
npm run build:backend
npm start
```

Tests and browser preview:

```powershell
npm test              # analysis, demo-worker and jsdom UI tests
npm run fixtures      # regenerate anonymized JSON demo fixtures
npm run preview       # Electron-free preview at http://localhost:5173/dev/preview.html
```

## Windows build

```powershell
npm run build:backend
npm run dist
```

Every push to `main` is built on GitHub Actions. The workflow publishes both the portable EXE and installer EXE into a unique GitHub Release.
