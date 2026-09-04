# MatchFrame

MatchFrame is a Windows desktop application for Counter-Strike 2 demo replay, player POV inspection, timeline analysis, and console-driven demo control.

## Architecture

- Electron: desktop UI
- Rust: core backend and IPC
- C++: Windows / CS2 process bridge
- Ruby: analytics rule engine
- x86-64 Assembly: hot-path native helpers

> Early development build.
