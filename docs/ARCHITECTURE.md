# MatchFrame architecture

## UI — Electron
The renderer is isolated with `contextIsolation` and no Node.js access. `preload.cjs` exposes a very small IPC API. Demo decoding runs in a worker thread so large `.dem` files do not freeze the window.

## Rust core
`matchframe-core.exe` is a JSON-lines backend process. Electron sends requests over stdin and receives structured responses over stdout. Rust owns orchestration and will become the primary analysis/data model layer.

## C++ bridge
The native C++ module currently detects `cs2.exe`, locates its top-level window and can forward developer-console commands using Win32 input. This is intentionally isolated behind Rust FFI because Valve/HLAE behaviour can change.

## Assembly
`fastmath.asm` is assembled with NASM and linked into the Rust binary. The first helper is a small ABI/probe routine; future SIMD routines will be used only where benchmarks show a measurable win (timeline transforms, spatial batches, visibility math).

## Ruby analytics
Ruby owns rule-based coaching text and experimentation. It is included as a runtime analytics script and is also used during CI as a build-time rule/default generator. Rust provides graceful errors when a local Ruby runtime is unavailable; a self-contained Ruby/mruby runtime is planned before the stable release.

## Demo adapter
The Electron demo worker currently uses `@laihoe/demoparser2`. It is kept behind one worker boundary so another parser or vendored Rust parser can be swapped in when CS2 updates break a specific demo format.

## Real POV
MatchFrame does not fake a video. Real POV playback is delegated to CS2 itself with `+playdemo`. MatchFrame's timeline and console then issue demo/spectator commands. A future native/HLAE adapter will add deterministic player selection/camera control where current CS2 builds permit it.
