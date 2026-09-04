const { parentPort } = require('node:worker_threads');
const { parseHeader, parsePlayerInfo, parseEvent, parseTicks } = require('@laihoe/demoparser2');

function safeEvent(file, name, player = [], other = []) {
  try { return parseEvent(file, name, player, other); } catch (_) { return []; }
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
      steamid: String(row.steamid ?? row.player_steamid ?? ''),
      name: String(row.name ?? row.player_name ?? ''),
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

function eventTick(event) {
  return finite(event?.tick) ?? 0;
}

function inferTickRate(roundStarts) {
  const samples = [];
  const starts = [...roundStarts].sort((a, b) => eventTick(a) - eventTick(b));
  for (let i = 1; i < starts.length; i++) {
    const prevTick = eventTick(starts[i - 1]);
    const tick = eventTick(starts[i]);
    const prevTime = finite(starts[i - 1].round_start_time);
    const time = finite(starts[i].round_start_time);
    if (prevTime === null || time === null || time <= prevTime || tick <= prevTick) continue;
    const rate = (tick - prevTick) / (time - prevTime);
    if (rate >= 30 && rate <= 256) samples.push(rate);
  }
  if (!samples.length) return 64;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const common = [32, 64, 128];
  return common.reduce((best, value) => Math.abs(value - median) < Math.abs(best - median) ? value : best, 64);
}

function buildRoundMeta(roundStarts, roundEnds, maxTick) {
  let starts = [...roundStarts]
    .map((event) => ({
      tick: eventTick(event),
      warmup: Boolean(event.is_warmup_period),
      played: finite(event.total_rounds_played),
      time: finite(event.round_start_time)
    }))
    .filter((x) => x.tick >= 0 && !x.warmup)
    .sort((a, b) => a.tick - b.tick);

  // Some demos duplicate round_start packets. Keep one start per nearby tick.
  starts = starts.filter((item, index) => index === 0 || item.tick - starts[index - 1].tick > 16);

  const ends = [...roundEnds].map(eventTick).filter((x) => x > 0).sort((a, b) => a - b);
  if (!starts.length && ends.length) {
    let previous = 0;
    starts = ends.map((end, index) => {
      const item = { tick: previous, played: index, time: null, warmup: false };
      previous = end + 1;
      return item;
    });
  }

  return starts.map((start, index) => {
    const nextStart = starts[index + 1]?.tick;
    const matchingEnd = ends.find((end) => end >= start.tick && (nextStart == null || end < nextStart));
    const endTick = matchingEnd ?? (nextStart != null ? Math.max(start.tick, nextStart - 1) : maxTick);
    return {
      number: Number.isFinite(start.played) ? start.played + 1 : index + 1,
      startTick: start.tick,
      endTick: Math.max(start.tick, endTick)
    };
  });
}

parentPort.on('message', ({ file }) => {
  try {
    const header = parseHeader(file);
    const players = parsePlayerInfo(file);
    const roundStarts = safeEvent(file, 'round_start', [], ['round_start_time', 'total_rounds_played', 'is_warmup_period']);
    const roundEnds = safeEvent(file, 'round_end', [], ['total_rounds_played', 'is_warmup_period']);
    const deaths = safeEvent(file, 'player_death', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const plants = safeEvent(file, 'bomb_planted', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const defuses = safeEvent(file, 'bomb_defused', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const explosions = safeEvent(file, 'bomb_exploded', [], ['total_rounds_played']);

    const eventTicks = [...roundStarts, ...roundEnds, ...deaths, ...plants, ...defuses, ...explosions]
      .map(eventTick)
      .filter(Number.isFinite);
    let maxTick = eventTicks.length ? Math.max(...eventTicks) : 0;

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
        if (frames.length) maxTick = Math.max(maxTick, frames[frames.length - 1].tick);
      } catch (error) {
        viewerError = error?.message || String(error);
      }
    }

    const tickRate = inferTickRate(roundStarts);
    const roundMeta = buildRoundMeta(roundStarts, roundEnds, maxTick);

    parentPort.postMessage({
      ok: true,
      data: {
        header,
        players,
        roundStarts,
        rounds: roundEnds,
        roundMeta,
        deaths,
        plants,
        defuses,
        explosions,
        maxTick,
        tickRate,
        durationSeconds: maxTick / tickRate,
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
