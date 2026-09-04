const { parentPort } = require('node:worker_threads');
const { parseHeader, parsePlayerInfo, parseEvent, parseTicks } = require('@laihoe/demoparser2');

function safeEvent(file, name, player = [], other = []) {
  try { return parseEvent(file, name, player, other); } catch (_) { return []; }
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
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
      fov: finite(row.fov) ?? 90,
      duck_amount: finite(row.duck_amount) ?? 0,
      in_crouch: Boolean(row.in_crouch),
      health: finite(row.health) ?? 0,
      armor: finite(row.armor) ?? 0,
      is_alive: Boolean(row.is_alive),
      team_num: finite(row.team_num) ?? 0,
      team_name: String(row.team_name ?? ''),
      team_clan_name: String(row.team_clan_name ?? ''),
      active_weapon_name: String(row.active_weapon_name ?? ''),
      active_weapon_ammo: finite(row.active_weapon_ammo)
    });
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

function cleanTeamName(value) {
  const name = String(value ?? '').trim();
  if (!name) return '';
  if (/^(t|terrorist|terrorists)$/i.test(name)) return '';
  if (/^(ct|counter[- _]?terrorist|counter[- _]?terrorists)$/i.test(name)) return '';
  return name;
}

function enrichPlayersWithTeams(players, frames) {
  const latest = new Map();
  const wanted = new Set((players || []).map((p) => String(p.steamid ?? '')).filter(Boolean));
  for (let i = frames.length - 1; i >= 0 && latest.size < wanted.size; i--) {
    for (const state of frames[i].players || []) {
      const steamid = String(state.steamid || '');
      const teamNum = Number(state.team_num || 0);
      if (!steamid || !wanted.has(steamid) || latest.has(steamid) || (teamNum !== 2 && teamNum !== 3)) continue;
      latest.set(steamid, state);
    }
  }

  const votes = new Map([[2, new Map()], [3, new Map()]]);
  for (const state of latest.values()) {
    const teamNum = Number(state.team_num || 0);
    const name = cleanTeamName(state.team_clan_name) || cleanTeamName(state.team_name);
    if (!name || !votes.has(teamNum)) continue;
    const bucket = votes.get(teamNum);
    bucket.set(name, (bucket.get(name) || 0) + 1);
  }

  const labels = new Map();
  for (const teamNum of [2, 3]) {
    const entries = [...votes.get(teamNum).entries()].sort((a, b) => b[1] - a[1]);
    labels.set(teamNum, entries[0]?.[0] || (teamNum === 2 ? 'Terrorists' : 'Counter-Terrorists'));
  }

  return (players || []).map((player) => {
    const steamid = String(player.steamid ?? '');
    const state = latest.get(steamid);
    const teamNum = Number(state?.team_num ?? player.team_number ?? 0);
    const ownName = cleanTeamName(state?.team_clan_name) || cleanTeamName(state?.team_name);
    return {
      ...player,
      team_number: teamNum,
      team_name: ownName || labels.get(teamNum) || 'Takımsız'
    };
  });
}

function buildCameraTracks(data) {
  const tracks = new Map();
  const push = (steamidRaw, nameRaw, tickRaw, source) => {
    const steamid = String(steamidRaw ?? '');
    const tick = finite(tickRaw);
    const X = finite(source.X), Y = finite(source.Y), Z = finite(source.Z);
    if (!steamid || tick === null || X === null || Y === null || Z === null) return;
    if (X === 0 && Y === 0 && Z === 0) return;
    let track = tracks.get(steamid);
    if (!track) {
      track = { steamid, name: String(nameRaw ?? ''), ticks: [], values: [] };
      tracks.set(steamid, track);
    }
    track.ticks.push(tick);
    track.values.push(
      X, Y, Z,
      finite(source.pitch) ?? 0,
      finite(source.yaw) ?? 0,
      finite(source.fov) ?? 90,
      finite(source.duck_amount) ?? 0
    );
  };

  if (Array.isArray(data)) {
    for (const row of data) push(row.steamid, row.name, row.tick, row);
  } else if (data && data.tick && typeof data.tick.length === 'number') {
    const count = data.tick.length;
    for (let i = 0; i < count; i++) {
      push(data.steamid?.[i], data.name?.[i], data.tick[i], {
        X: data.X?.[i], Y: data.Y?.[i], Z: data.Z?.[i],
        pitch: data.pitch?.[i], yaw: data.yaw?.[i],
        fov: data.fov?.[i], duck_amount: data.duck_amount?.[i]
      });
    }
  }

  return [...tracks.values()].map((track) => ({
    steamid: track.steamid,
    name: track.name,
    ticks: Int32Array.from(track.ticks),
    values: Float32Array.from(track.values),
    stride: 7
  }));
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
    const rawPlayers = parsePlayerInfo(file);
    const roundStarts = safeEvent(file, 'round_start', [], ['round_start_time', 'total_rounds_played', 'is_warmup_period']);
    const roundEnds = safeEvent(file, 'round_end', [], ['total_rounds_played', 'is_warmup_period']);
    const deaths = safeEvent(file, 'player_death', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const plants = safeEvent(file, 'bomb_planted', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const defuses = safeEvent(file, 'bomb_defused', ['player_steamid', 'player_name'], ['total_rounds_played']);
    const explosions = safeEvent(file, 'bomb_exploded', [], ['total_rounds_played']);

    const smokeStarts = safeEvent(file, 'smokegrenade_detonate', ['player_steamid', 'player_name'], []);
    const smokeEnds = safeEvent(file, 'smokegrenade_expired', ['player_steamid', 'player_name'], []);
    const infernoStarts = safeEvent(file, 'inferno_startburn', ['player_steamid', 'player_name'], []);
    const infernoEnds = safeEvent(file, 'inferno_expire', ['player_steamid', 'player_name'], []);
    const heDetonates = safeEvent(file, 'hegrenade_detonate', ['player_steamid', 'player_name'], []);
    const flashDetonates = safeEvent(file, 'flashbang_detonate', ['player_steamid', 'player_name'], []);
    const playerBlinds = safeEvent(file, 'player_blind', ['player_steamid', 'player_name'], ['blind_duration']);
    const decoyStarts = safeEvent(file, 'decoy_started', ['player_steamid', 'player_name'], []);
    const decoyEnds = safeEvent(file, 'decoy_detonate', ['player_steamid', 'player_name'], []);

    const utility = {
      smokeStarts,
      smokeEnds,
      infernoStarts,
      infernoEnds,
      heDetonates,
      flashDetonates,
      playerBlinds,
      decoyStarts,
      decoyEnds
    };

    const eventTicks = [
      ...roundStarts, ...roundEnds, ...deaths, ...plants, ...defuses, ...explosions,
      ...smokeStarts, ...smokeEnds, ...infernoStarts, ...infernoEnds, ...heDetonates, ...flashDetonates, ...playerBlinds
    ].map(eventTick).filter(Number.isFinite);
    let maxTick = eventTicks.length ? Math.max(...eventTicks) : 0;

    let frames = [];
    let viewerError = null;
    let sampleStep = 8;
    if (maxTick > 0) {
      sampleStep = maxTick > 220000 ? 16 : maxTick > 150000 ? 12 : 8;
      const wantedTicks = [];
      for (let tick = 0; tick <= maxTick; tick += sampleStep) wantedTicks.push(tick);
      try {
        const rows = parseTicks(file, [
          'X','Y','Z','pitch','yaw','fov','duck_amount','in_crouch','health','armor','is_alive','team_num','team_name','team_clan_name','active_weapon_name','active_weapon_ammo'
        ], wantedTicks);
        frames = buildFrames(rows);
        if (frames.length) maxTick = Math.max(maxTick, frames[frames.length - 1].tick);
      } catch (error) {
        viewerError = error?.message || String(error);
      }
    }

    const players = enrichPlayersWithTeams(rawPlayers, frames);

    let cameraTracks = [];
    let cameraError = null;
    try {
      const exact = parseTicks(file, ['X','Y','Z','pitch','yaw','fov','duck_amount'], null, true);
      cameraTracks = buildCameraTracks(exact);
    } catch (error) {
      cameraError = error?.message || String(error);
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
        utility,
        maxTick,
        tickRate,
        durationSeconds: maxTick / tickRate,
        sampleStep,
        frames,
        cameraTracks,
        cameraError,
        bounds: boundsFromFrames(frames),
        viewerError
      }
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error?.stack || String(error) });
  }
});
