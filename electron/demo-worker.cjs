const { parentPort } = require('node:worker_threads');
const { parseHeader, parsePlayerInfo, parseEvent, parseTicks } = require('@laihoe/demoparser2');

function safeEvent(file, name) {
  try { return parseEvent(file, name, [], []); } catch (_) { return []; }
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildFrames(rows) {
  const byTick = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tick = finite(row.tick);
    if (tick === null) continue;
    let frame = byTick.get(tick);
    if (!frame) {
      frame = { tick, players: [] };
      byTick.set(tick, frame);
    }
    frame.players.push({
      steamid: String(row.steamid ?? ''),
      name: String(row.name ?? ''),
      X: finite(row.X),
      Y: finite(row.Y),
      Z: finite(row.Z),
      pitch: finite(row.pitch) ?? 0,
      yaw: finite(row.yaw) ?? 0,
      health: finite(row.health) ?? 0,
      is_alive: Boolean(row.is_alive),
      team_num: finite(row.team_num) ?? 0
    });
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

function boundsFromFrames(frames) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const frame of frames) {
    for (const p of frame.players) {
      if (!Number.isFinite(p.X) || !Number.isFinite(p.Y)) continue;
      minX = Math.min(minX, p.X); maxX = Math.max(maxX, p.X);
      minY = Math.min(minY, p.Y); maxY = Math.max(maxY, p.Y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const padX = Math.max(128, (maxX - minX) * 0.08);
  const padY = Math.max(128, (maxY - minY) * 0.08);
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

parentPort.on('message', ({ file }) => {
  try {
    const header = parseHeader(file);
    const players = parsePlayerInfo(file);
    const rounds = safeEvent(file, 'round_end');
    const deaths = safeEvent(file, 'player_death');
    const plants = safeEvent(file, 'bomb_planted');
    const defuses = safeEvent(file, 'bomb_defused');
    const explosions = safeEvent(file, 'bomb_exploded');

    const eventTicks = [...rounds, ...deaths, ...plants, ...defuses, ...explosions]
      .map((event) => Number(event.tick || 0))
      .filter(Number.isFinite);
    const maxTick = eventTicks.length ? Math.max(...eventTicks) : 0;

    let frames = [];
    let viewerError = null;
    let sampleStep = 8;
    if (maxTick > 0) {
      sampleStep = maxTick > 220000 ? 16 : maxTick > 150000 ? 12 : 8;
      const wantedTicks = [];
      for (let tick = 0; tick <= maxTick; tick += sampleStep) wantedTicks.push(tick);
      try {
        const rows = parseTicks(file, ['X', 'Y', 'Z', 'pitch', 'yaw', 'health', 'is_alive', 'team_num'], wantedTicks);
        frames = buildFrames(rows);
      } catch (error) {
        viewerError = error?.message || String(error);
      }
    }

    parentPort.postMessage({
      ok: true,
      data: {
        header,
        players,
        rounds,
        deaths,
        plants,
        defuses,
        explosions,
        maxTick,
        sampleStep,
        frames,
        bounds: boundsFromFrames(frames),
        viewerError
      }
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error?.stack || String(error) });
  }
});
