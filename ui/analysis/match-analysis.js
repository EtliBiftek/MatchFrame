/*
 * MatchFrame — maç analiz modeli (saf hesaplama katmanı)
 *
 * `buildMatchModel(demo)` demo-worker çıktısını bir kez tarar ve tüm sol panel
 * ekranlarının kullanacağı normalize modeli üretir. DOM'a dokunmaz.
 *
 * Çıktı şeması: docs/ANALYSIS-MODEL.md
 */
(function (root, factory) {
  'use strict';
  const common = (typeof module === 'object' && module.exports)
    ? require('./common.js')
    : root.MF.analysis;
  const api = factory(common);
  if (typeof module === 'object' && module.exports) module.exports = api;
  const ns = (root.MF = root.MF || {});
  ns.analysis = Object.assign(ns.analysis || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (common) {
  'use strict';

  const MODEL_SCHEMA_VERSION = 1;

  const DEFAULTS = {
    tradeWindowSeconds: 5,
    minRosterForClutch: 3,
    scanFramesPerRound: 12
  };

  const {
    num, str, bool, safeDiv, percent, normalizeSteamId, firstValue, firstText, firstNumber,
    makeDataset, missingDataset, isAvailable, normalizeWeapon, sideFromTeamNumber,
    sortByTick, roundIndexForTick, assignRounds, normalizeKillEvent, normalizeHurtEvent,
    normalizeShotEvent, normalizeUtilityEvent, normalizeBlindEvent, normalizeBombEvent,
    roundEndReasonLabel
  } = common;

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */

  function eventStatusOf(demo, name) {
    const status = demo?.eventStatus?.[name];
    if (!status) return null;
    if (status.ok === false) return status.error || `${name} parse edilemedi`;
    return null;
  }

  function datasetFrom(demo, key, eventName, fallbackMessage) {
    const rows = demo?.[key];
    const error = eventStatusOf(demo, eventName);
    if (error) return makeDataset(null, error);
    if (rows === undefined || rows === null) return makeDataset(null, fallbackMessage);
    return makeDataset(rows, null);
  }

  function frameIndexAtOrAfter(frames, tick) {
    let lo = 0;
    let hi = frames.length - 1;
    let result = frames.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Number(frames[mid].tick) >= tick) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return result;
  }

  /*
   * Round bazında oyuncu tarafı. CS2'de devre arasında taraf değiştiği için
   * statik `players[].team_number` tek başına yeterli değil. Varsa tick
   * state'inden (frames) round içindeki ilk görülen team_num kullanılır.
   */
  function buildSidesByRound(demo, rounds) {
    const frames = Array.isArray(demo?.frames) ? demo.frames : [];
    const result = { byRound: [], source: 'unknown', roster: new Map() };

    const staticTeams = new Map();
    for (const player of demo?.players || []) {
      const steamId = normalizeSteamId(player?.steamid);
      const team = num(player?.team_number);
      if (steamId && (team === 2 || team === 3)) staticTeams.set(steamId, team);
    }

    if (!frames.length) {
      for (let i = 0; i < rounds.length; i++) result.byRound.push(new Map(staticTeams));
      result.source = staticTeams.size ? 'player-list' : 'unknown';
      result.roster = new Map(staticTeams);
      return result;
    }

    let sampled = 0;
    for (const round of rounds) {
      const sides = new Map(staticTeams);
      let index = frameIndexAtOrAfter(frames, round.startTick);
      let scanned = 0;
      while (index < frames.length && Number(frames[index].tick) <= round.endTick && scanned < DEFAULTS.scanFramesPerRound) {
        for (const player of frames[index].players || []) {
          const steamId = normalizeSteamId(player?.steamid);
          const team = num(player?.team_num);
          if (!steamId || (team !== 2 && team !== 3)) continue;
          if (!sides.has(steamId)) sides.set(steamId, team);
          else if (sides.get(steamId) !== team) sides.set(steamId, team);
        }
        index += 1;
        scanned += 1;
      }
      sampled += scanned;
      result.byRound.push(sides);
    }

    const merged = new Map(staticTeams);
    for (const sides of result.byRound) {
      for (const [steamId, team] of sides) {
        merged.set(steamId, team);
        if (!result.roster.has(steamId)) result.roster.set(steamId, team);
      }
    }
    result.source = sampled ? 'tick-state' : staticTeams.size ? 'player-list' : 'unknown';
    result.roster = merged;
    return result;
  }

  function fillUnknownSides(sides, kills) {
    let changed = true;
    let guard = 0;
    while (changed && guard < 4) {
      changed = false;
      guard += 1;
      for (const kill of kills) {
        const attackerTeam = sides.get(kill.actorSteamId);
        const victimTeam = sides.get(kill.targetSteamId);
        if (!kill.actorSteamId || !kill.targetSteamId) continue;
        if (attackerTeam && !victimTeam && !kill.teamKill) {
          sides.set(kill.targetSteamId, attackerTeam === 2 ? 3 : 2);
          changed = true;
        } else if (!attackerTeam && victimTeam) {
          sides.set(kill.actorSteamId, victimTeam === 2 ? 3 : 2);
          changed = true;
        }
      }
    }
    return sides;
  }

  function simulateRound(round, sides, killsSorted) {
    const alive = new Map();
    for (const [steamId, team] of sides) {
      if (team === 2 || team === 3) alive.set(steamId, team);
    }
    const counts = () => {
      const result = { 2: 0, 3: 0 };
      for (const team of alive.values()) if (result[team] != null) result[team] += 1;
      return result;
    };

    const deaths = [];
    let clutch = null;
    let state = counts();

    for (const kill of killsSorted) {
      if (!kill.targetSteamId) continue;
      if (alive.has(kill.targetSteamId)) alive.delete(kill.targetSteamId);
      deaths.push(kill);
      state = counts();
      if (clutch) continue;
      for (const team of [2, 3]) {
        const other = team === 2 ? 3 : 2;
        if (state[team] === 1 && state[other] >= 2) {
          let survivor = '';
          for (const [steamId, side] of alive) if (side === team) { survivor = steamId; break; }
          clutch = {
            team,
            side: sideFromTeamNumber(team),
            playerSteamId: survivor,
            opponents: state[other],
            startTick: Number(kill.tick) || 0
          };
          break;
        }
      }
    }

    return { alive, counts: state, clutch, deaths };
  }

  function inferRoundOutcome(round, sides, killsSorted) {
    if (round.bombExploded) return { winnerTeamNumber: 2, reason: 'Bomba patladı', reasonCode: null };
    if (round.bombDefused) return { winnerTeamNumber: 3, reason: 'Bomba imha edildi', reasonCode: null };
    const simulation = round.simulation;
    if (simulation) {
      if (simulation.counts[2] === 0 && simulation.counts[3] > 0) return { winnerTeamNumber: 3, reason: 'T elendi', reasonCode: null };
      if (simulation.counts[3] === 0 && simulation.counts[2] > 0) return { winnerTeamNumber: 2, reason: 'CT elendi', reasonCode: null };
    }
    return { winnerTeamNumber: 3, reason: 'Süre doldu', reasonCode: null };
  }

  /* ------------------------------------------------------------------ *
   * Oyuncu modeli
   * ------------------------------------------------------------------ */

  function createPlayer(steamId) {
    return {
      steamId,
      name: '',
      teamNumber: 0,
      side: '',
      identity: { steamId, name: '' },
      totals: {
        kills: 0,
        deaths: 0,
        assists: 0,
        flashAssists: 0,
        headshotKills: 0,
        headshotPercent: 0,
        teamKills: 0,
        suicides: 0,
        entryKills: 0,
        entryDeaths: 0,
        entryAttempts: 0,
        tradeKills: 0,
        tradedDeaths: 0,
        plants: 0,
        defuses: 0,
        damage: 0,
        adr: null,
        kastPercent: null,
        kd: 0,
        kpr: 0,
        multiKills: { 2: 0, 3: 0, 4: 0, 5: 0 },
        clutches: { attempts: 0, won: 0, byCount: {} },
        utility: { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0 },
        utilityDamage: 0
      },
      rounds: {},
      weapons: {},
      aim: null,
      utility: null
    };
  }

  function playerRound(player, roundNumber) {
    const key = String(roundNumber);
    if (!player.rounds[key]) {
      player.rounds[key] = {
        round: Number(roundNumber),
        kills: 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        headshotKills: 0,
        survived: true,
        traded: false
      };
    }
    return player.rounds[key];
  }

  function ensureWeapon(player, weaponKey, weaponLabel) {
    if (!player.weapons[weaponKey]) {
      player.weapons[weaponKey] = { key: weaponKey, label: weaponLabel || weaponKey, kills: 0, headshots: 0, shots: 0, hits: 0, damage: 0 };
    }
    return player.weapons[weaponKey];
  }

  /* ------------------------------------------------------------------ *
   * Ana model kurucu
   * ------------------------------------------------------------------ */

  function emptyModel(reason) {
    return {
      schemaVersion: MODEL_SCHEMA_VERSION,
      ready: false,
      reason: reason || 'Demo yüklenmedi',
      match: emptyMatch(),
      availability: {},
      teams: [],
      players: {},
      playerOrder: [],
      rounds: [],
      events: { kills: [], damage: [], shots: [], impacts: [], utility: [], blinds: [], bomb: [] },
      notes: [],
      config: { ...DEFAULTS }
    };
  }

  function emptyMatch() {
    return {
      map: '',
      server: '',
      file: '',
      durationSeconds: 0,
      tickRate: 64,
      roundsPlayed: 0,
      maxTick: 0,
      score: { T: 0, CT: 0 }
    };
  }

  function buildMatchModel(demo, options = {}) {
    const config = { ...DEFAULTS, ...(options || {}) };
    if (!demo || typeof demo !== 'object') return emptyModel('Demo yüklenmedi');

    const notes = [];
    const tickRate = num(demo.tickRate) || 64;
    const maxTick = num(demo.maxTick) || 0;

    /* --- event normalizasyonu ---------------------------------------- */
    const kills = sortByTick((demo.deaths || []).map(normalizeKillEvent)).map((kill) => {
      kill.headshot = Boolean(kill.headshot);
      return kill;
    });
    const damage = sortByTick((demo.damage || []).map(normalizeHurtEvent));
    const shots = sortByTick((demo.shots || []).map(normalizeShotEvent));
    const blinds = sortByTick((demo.blinds || demo.utility?.playerBlinds || []).map(normalizeBlindEvent));
    const bombEvents = sortByTick([
      ...(demo.bomb?.plants || demo.plants || []).map((raw) => normalizeBombEvent(raw, 'bomb_planted')),
      ...(demo.bomb?.defuses || demo.defuses || []).map((raw) => normalizeBombEvent(raw, 'bomb_defused')),
      ...(demo.bomb?.explosions || demo.explosions || []).map((raw) => normalizeBombEvent(raw, 'bomb_exploded')),
      ...(demo.bomb?.drops || []).map((raw) => normalizeBombEvent(raw, 'bomb_dropped')),
      ...(demo.bomb?.pickups || []).map((raw) => normalizeBombEvent(raw, 'bomb_pickup'))
    ]);
    const utilityEvents = sortByTick(collectUtilityEvents(demo));

    /* --- veri bulunabilirliği --------------------------------------- */
    const roundEndEvents = Array.isArray(demo.roundEnds) ? demo.roundEnds : demo.rounds;

    const availability = {
      rounds: makeDataset(demo.roundMeta, eventStatusOf(demo, 'round_start')),
      roundEnds: makeDataset(roundEndEvents, eventStatusOf(demo, 'round_end')),
      kills: datasetFrom(demo, 'deaths', 'player_death', 'player_death bu demo için parse edilmedi'),
      damage: datasetFrom(demo, 'damage', 'player_hurt', 'player_hurt bu demo için parse edilmedi'),
      shots: datasetFrom(demo, 'shots', 'weapon_fire', 'weapon_fire bu demo için parse edilmedi'),
      impacts: datasetFrom(demo, 'impacts', 'bullet_impact', 'bullet_impact bu demo için parse edilmedi'),
      blinds: datasetFrom(demo, 'blinds', 'player_blind', 'player_blind bu demo için parse edilmedi'),
      utility: makeDataset(utilityEvents, eventStatusOf(demo, 'smokegrenade_detonate') || eventStatusOf(demo, 'flashbang_detonate')),
      bomb: makeDataset(bombEvents, eventStatusOf(demo, 'bomb_planted')),
      freezeEnd: datasetFrom(demo, 'freezeEnds', 'round_freeze_end', 'round_freeze_end bu demo için parse edilmedi')
    };

    if (availability.rounds.available && !availability.rounds.count) availability.rounds = makeDataset(null, 'round_start eventi bulunamadı');
    if (!isAvailable(availability.kills)) notes.push({ level: 'warn', dataset: 'kills', message: `Kill verisi yok: ${availability.kills.error}` });
    if (!isAvailable(availability.damage)) notes.push({ level: 'warn', dataset: 'damage', message: `Hasar verisi yok: ${availability.damage.error} (ADR ve KAST hesaplanamıyor)` });
    if (!isAvailable(availability.shots)) notes.push({ level: 'warn', dataset: 'shots', message: `Atış verisi yok: ${availability.shots.error} (accuracy hesaplanamıyor)` });

    /* --- roundlar ---------------------------------------------------- */
    const roundMeta = Array.isArray(demo.roundMeta) ? [...demo.roundMeta].sort((a, b) => (num(a?.startTick) || 0) - (num(b?.startTick) || 0)) : [];
    const rounds = roundMeta.map((meta, index) => ({
      number: num(meta?.number) ?? index + 1,
      index,
      startTick: num(meta?.startTick) ?? 0,
      endTick: num(meta?.endTick) ?? num(demo.maxTick) ?? 0,
      durationSeconds: 0,
      winnerTeamNumber: 0,
      winnerSide: '',
      reason: '',
      reasonCode: null,
      outcomeSource: 'unknown',
      kills: [],
      damage: [],
      shots: [],
      utility: [],
      blinds: [],
      bomb: [],
      firstKill: null,
      firstDeath: null,
      bombPlanted: false,
      bombDefused: false,
      bombExploded: false,
      survivors: { T: 0, CT: 0 },
      clutch: null,
      scoreAfter: { T: 0, CT: 0 },
      roster: { T: [], CT: [] }
    }));

    assignRounds(kills, rounds);
    assignRounds(damage, rounds);
    assignRounds(shots, rounds);
    assignRounds(blinds, rounds);
    assignRounds(bombEvents, rounds);
    assignRounds(utilityEvents, rounds);

    const roundsById = rounds.map((round) => ({
      kills: [], damage: [], shots: [], utility: [], blinds: [], bomb: []
    }));

    const playerIndex = new Map();
    const ensurePlayer = (steamId, name) => {
      const key = normalizeSteamId(steamId);
      if (!key) return null;
      let player = playerIndex.get(key);
      if (!player) {
        player = createPlayer(key);
        playerIndex.set(key, player);
      }
      if (!player.name && name) player.name = str(name);
      return player;
    };

    // Round bazlı taraf haritaları; bilinmeyenler kill ilişkisinden tamamlanır.
    const sidesInfo = buildSidesByRound(demo, rounds);

    for (const player of demo?.players || []) ensurePlayer(player?.steamid, player?.name);
    for (const kill of kills) {
      ensurePlayer(kill.actorSteamId, kill.actorName);
      ensurePlayer(kill.targetSteamId, kill.targetName);
      ensurePlayer(kill.assisterSteamId, kill.assisterName);
    }
    for (const event of damage) {
      ensurePlayer(event.actorSteamId, event.actorName);
      ensurePlayer(event.targetSteamId, event.targetName);
    }
    for (const event of bombEvents) ensurePlayer(event.actorSteamId, event.actorName);
    for (const event of utilityEvents) ensurePlayer(event.actorSteamId, event.actorName);

    /* --- eventleri roundlara dağıt ----------------------------------- */
    for (const kill of kills) {
      if (kill.roundIndex >= 0) roundsById[kill.roundIndex].kills.push(kill);
    }
    for (const event of damage) if (event.roundIndex >= 0) roundsById[event.roundIndex].damage.push(event);
    for (const event of shots) if (event.roundIndex >= 0) roundsById[event.roundIndex].shots.push(event);
    for (const event of blinds) if (event.roundIndex >= 0) roundsById[event.roundIndex].blinds.push(event);
    for (const event of utilityEvents) if (event.roundIndex >= 0) roundsById[event.roundIndex].utility.push(event);
    for (const event of bombEvents) if (event.roundIndex >= 0) roundsById[event.roundIndex].bomb.push(event);

    // Bilinmeyen taraflar round içindeki kill ilişkisinden tamamlanır.
    for (let i = 0; i < rounds.length; i++) {
      const sides = fillUnknownSides(new Map(sidesInfo.byRound[i] || new Map()), roundsById[i].kills);
      sidesInfo.byRound[i] = sides;
      for (const steamId of sides.keys()) {
        if (!playerIndex.has(steamId)) ensurePlayer(steamId, '');
      }
    }

    /* --- taraf bilgisini eventlere ve oyunculara işle ---------------- */
    const sideFor = (steamId, roundIndex) => {
      if (roundIndex >= 0) {
        const team = sidesInfo.byRound[roundIndex]?.get(steamId);
        if (team === 2 || team === 3) return team;
      }
      const fallback = sidesInfo.roster.get(steamId);
      return fallback === 2 || fallback === 3 ? fallback : 0;
    };

    for (const kill of kills) {
      kill.attackerTeam = sideFor(kill.actorSteamId, kill.roundIndex);
      kill.victimTeam = sideFor(kill.targetSteamId, kill.roundIndex);
      kill.teamKill = Boolean(kill.attackerTeam && kill.victimTeam && kill.attackerTeam === kill.victimTeam);
    }
    for (const event of damage) {
      event.attackerTeam = sideFor(event.actorSteamId, event.roundIndex);
      event.victimTeam = sideFor(event.targetSteamId, event.roundIndex);
      event.friendlyFire = Boolean(event.attackerTeam && event.victimTeam && event.attackerTeam === event.victimTeam);
    }

    /* --- round sonuçları --------------------------------------------- */
    const parserEnds = sortByTick(Array.isArray(roundEndEvents) ? roundEndEvents : []);
    const endByRoundIndex = new Map();
    for (const end of parserEnds) {
      const index = roundIndexForTick(rounds, end?.tick);
      if (index >= 0 && !endByRoundIndex.has(index)) endByRoundIndex.set(index, end);
    }

    /* --- takım çıkarımı (devre arası taraf değişimine dayanıklı) ----- */
    const teamInfo = deriveTeams(demo, sidesInfo.byRound);
    const scoreByTeam = new Map(teamInfo.teams.map((team) => [team.id, 0]));

    rounds.forEach((round, index) => {
      const bucket = roundsById[index];
      round.kills = bucket.kills;
      round.damage = bucket.damage;
      round.shots = bucket.shots;
      round.utility = bucket.utility;
      round.blinds = bucket.blinds;
      round.bomb = bucket.bomb;
      round.durationSeconds = Math.max(0, (round.endTick - round.startTick) / tickRate);

      const roundKills = bucket.kills.filter((kill) => !kill.suicide && !kill.teamKill);
      round.firstKill = roundKills[0] || null;
      round.firstDeath = bucket.kills[0] || null;

      for (const event of bucket.bomb) {
        if (event.kind === 'plant') round.bombPlanted = true;
        if (event.kind === 'defuse') round.bombDefused = true;
        if (event.kind === 'explode') round.bombExploded = true;
      }

      const sides = sidesInfo.byRound[index] || new Map();
      for (const [steamId, team] of sides) {
        if (team === 2) round.roster.T.push(steamId);
        if (team === 3) round.roster.CT.push(steamId);
      }

      const simulation = simulateRound(round, sides, bucket.kills);
      round.simulation = simulation;
      round.survivors = { T: simulation.counts[2] || 0, CT: simulation.counts[3] || 0 };

      const parserEnd = endByRoundIndex.get(index);
      const parserWinner = num(firstValue(parserEnd, ['winner', 'winner_team', 'winner_team_num']));
      const parserReasonCode = num(firstValue(parserEnd, ['reason']));
      if (parserWinner === 2 || parserWinner === 3) {
        round.winnerTeamNumber = parserWinner;
        round.reasonCode = parserReasonCode;
        round.reason = roundEndReasonLabel(parserReasonCode) || '';
        round.outcomeSource = 'parser';
      } else {
        const inferred = inferRoundOutcome(round, sides, bucket.kills);
        round.winnerTeamNumber = inferred.winnerTeamNumber;
        round.reason = inferred.reason;
        round.reasonCode = inferred.reasonCode;
        round.outcomeSource = 'inferred';
      }
      round.winnerSide = sideFromTeamNumber(round.winnerTeamNumber);
      round.teamBySide = {
        T: teamInfo.roundTeams[index]?.[2] || null,
        CT: teamInfo.roundTeams[index]?.[3] || null
      };
      round.winnerTeamId = round.teamBySide[round.winnerSide] || null;

      if (simulation.clutch) {
        const won = round.winnerTeamNumber === simulation.clutch.team;
        round.clutch = {
          ...simulation.clutch,
          won,
          playerTeamId: teamInfo.teamOfPlayer.get(simulation.clutch.playerSteamId) || null
        };
      }

      if (round.winnerTeamId && scoreByTeam.has(round.winnerTeamId)) {
        scoreByTeam.set(round.winnerTeamId, scoreByTeam.get(round.winnerTeamId) + 1);
      }
      round.scoreAfter = Object.fromEntries(scoreByTeam);
    });

    /* --- entry / trade / clutch -------------------------------------- */
    for (const round of rounds) {
      const deathsInRound = round.kills.filter((kill) => !kill.suicide);
      const opening = round.kills.find((kill) => !kill.suicide && !kill.teamKill);
      if (opening) {
        opening.isEntry = true;
        round.entryKill = {
          tick: opening.tick,
          attackerSteamId: opening.actorSteamId,
          attackerName: opening.actorName,
          victimSteamId: opening.targetSteamId,
          victimName: opening.targetName,
          weapon: opening.weaponLabel
        };
      } else {
        round.entryKill = null;
      }

      const window = Math.max(1, Number(config.tradeWindowSeconds) || 5) * tickRate;
      for (const death of deathsInRound) {
        if (death.teamKill || !death.actorSteamId) continue;
        for (const candidate of deathsInRound) {
          if (candidate === death) continue;
          if (Number(candidate.tick) <= Number(death.tick)) continue;
          if (Number(candidate.tick) - Number(death.tick) > window) break;
          if (candidate.targetSteamId !== death.actorSteamId) continue;
          if (candidate.actorSteamId === death.actorSteamId) continue;
          if (candidate.teamKill) continue;
          const sameSide = sideFor(candidate.actorSteamId, round.index) === sideFor(death.targetSteamId, round.index);
          if (!sameSide) continue;
          candidate.isTrade = true;
          candidate.tradeFor = death.targetSteamId;
          death.tradedBy = candidate.actorSteamId;
          death.traded = true;
          break;
        }
      }
      void deathsInRound;
    }

    /* --- oyuncu toplamları ------------------------------------------- */
    for (const kill of kills) {
      const roundNumber = kill.round;
      const attacker = kill.actorSteamId ? playerIndex.get(kill.actorSteamId) : null;
      const victim = kill.targetSteamId ? playerIndex.get(kill.targetSteamId) : null;
      const assister = kill.assisterSteamId ? playerIndex.get(kill.assisterSteamId) : null;

      if (victim) {
        victim.totals.deaths += 1;
        if (roundNumber != null) {
          const row = playerRound(victim, roundNumber);
          row.deaths += 1;
          row.survived = false;
        }
      }
      if (kill.suicide) {
        if (victim) victim.totals.suicides += 1;
        continue;
      }
      if (!attacker) continue;
      if (kill.teamKill) {
        attacker.totals.teamKills += 1;
        continue;
      }
      attacker.totals.kills += 1;
      if (kill.headshot) attacker.totals.headshotKills += 1;
      if (kill.isEntry) {
        attacker.totals.entryKills += 1;
        attacker.totals.entryAttempts += 1;
      }
      if (kill.isTrade) attacker.totals.tradeKills += 1;
      if (roundNumber != null) {
        const row = playerRound(attacker, roundNumber);
        row.kills += 1;
        if (kill.headshot) row.headshotKills += 1;
      }
      const weapon = ensureWeapon(attacker, kill.weapon, kill.weaponLabel);
      weapon.kills += 1;
      if (kill.headshot) weapon.headshots += 1;

      if (victim) {
        victim.totals.entryDeaths += Boolean(kill.isEntry) ? 1 : 0;
        victim.totals.tradedDeaths += kill.traded ? 1 : 0;
        if (roundNumber != null && kill.traded) playerRound(victim, roundNumber).traded = true;
      }
      if (assister) {
        assister.totals.assists += 1;
        if (kill.assistedFlash) assister.totals.flashAssists += 1;
        if (roundNumber != null) playerRound(assister, roundNumber).assists += 1;
      }
    }

    if (isAvailable(availability.damage)) {
      for (const event of damage) {
        if (!event.actorSteamId || event.friendlyFire) continue;
        const attacker = playerIndex.get(event.actorSteamId);
        if (!attacker) continue;
        const value = num(event.damage) || 0;
        if (value <= 0) continue;
        attacker.totals.damage += value;
        if (event.round != null) playerRound(attacker, event.round).damage += value;
        const weapon = ensureWeapon(attacker, event.weapon, event.weaponLabel);
        weapon.damage += value;
      }
    }

    if (isAvailable(availability.shots)) {
      for (const event of shots) {
        const player = event.actorSteamId ? playerIndex.get(event.actorSteamId) : null;
        if (!player) continue;
        const weapon = ensureWeapon(player, event.weapon, event.weaponLabel);
        weapon.shots += 1;
      }
    }

    for (const event of bombEvents) {
      const player = event.actorSteamId ? playerIndex.get(event.actorSteamId) : null;
      if (!player) continue;
      if (event.kind === 'plant') player.totals.plants += 1;
      if (event.kind === 'defuse') player.totals.defuses += 1;
    }

    for (const event of utilityEvents) {
      if (event.phase !== 'detonate' && event.phase !== 'start') continue;
      const player = event.actorSteamId ? playerIndex.get(event.actorSteamId) : null;
      if (!player) continue;
      if (player.totals.utility[event.kind] != null) player.totals.utility[event.kind] += 1;
    }

    for (const round of rounds) {
      const perPlayerKills = new Map();
      for (const kill of round.kills) {
        if (kill.suicide || kill.teamKill || !kill.actorSteamId) continue;
        perPlayerKills.set(kill.actorSteamId, (perPlayerKills.get(kill.actorSteamId) || 0) + 1);
      }
      for (const [steamId, count] of perPlayerKills) {
        const player = playerIndex.get(steamId);
        if (!player) continue;
        const bucket = Math.min(5, Math.max(2, count));
        player.totals.multiKills[bucket] = (player.totals.multiKills[bucket] || 0) + 1;
      }
      if (round.clutch && round.clutch.playerSteamId) {
        const player = playerIndex.get(round.clutch.playerSteamId);
        if (player) {
          player.totals.clutches.attempts += 1;
          if (round.clutch.won) player.totals.clutches.won += 1;
          const key = String(round.clutch.opponents);
          player.totals.clutches.byCount[key] = player.totals.clutches.byCount[key] || { attempts: 0, won: 0 };
          player.totals.clutches.byCount[key].attempts += 1;
          if (round.clutch.won) player.totals.clutches.byCount[key].won += 1;
        }
      }
      for (const player of playerIndex.values()) {
        const row = player.rounds[String(round.number)];
        const killsInRound = perPlayerKills.get(player.steamId) || 0;
        const assistsInRound = row?.assists || 0;
        const survived = !row || row.survived !== false;
        const traded = Boolean(row?.traded);
        if (killsInRound > 0 || assistsInRound > 0 || survived || traded) {
          player.totals.kastRounds = (player.totals.kastRounds || 0) + 1;
        }
      }
    }

    const roundsPlayed = rounds.length;
    const players = {};
    for (const player of playerIndex.values()) {
      const finalTeam = sidesInfo.roster.get(player.steamId) || 0;
      player.teamNumber = finalTeam;
      player.side = sideFromTeamNumber(finalTeam);
      player.teamId = teamInfo.teamOfPlayer.get(player.steamId) || null;
      player.teamName = (teamInfo.teamById.get(player.teamId)?.name) || '';
      const sidesPlayed = { T: 0, CT: 0 };
      for (const sides of sidesInfo.byRound) {
        const team = sides.get(player.steamId);
        if (team === 2) sidesPlayed.T += 1;
        else if (team === 3) sidesPlayed.CT += 1;
      }
      player.sidesPlayed = sidesPlayed;
      player.identity = { steamId: player.steamId, name: player.name || player.steamId };
      player.totals.headshotPercent = percent(player.totals.headshotKills, player.totals.kills, 0);
      player.totals.kd = Number(safeDiv(player.totals.kills, player.totals.deaths, player.totals.kills).toFixed(2));
      player.totals.kpr = Number(safeDiv(player.totals.kills, roundsPlayed, 0).toFixed(2));
      player.totals.adr = isAvailable(availability.damage) && roundsPlayed
        ? Number(safeDiv(player.totals.damage, roundsPlayed, 0).toFixed(1))
        : null;
      player.totals.kastPercent = roundsPlayed ? percent(player.totals.kastRounds || 0, roundsPlayed, 0) : null;
      delete player.totals.kastRounds;
      players[player.steamId] = player;
    }

    /* --- takımlar ----------------------------------------------------- */
    const teams = teamInfo.teams.map((team) => {
      const members = team.players.filter((steamId) => Boolean(players[steamId]));
      const totals = members.reduce((accumulator, steamId) => {
        const player = players[steamId];
        accumulator.kills += player.totals.kills;
        accumulator.deaths += player.totals.deaths;
        accumulator.assists += player.totals.assists;
        accumulator.plants += player.totals.plants;
        accumulator.defuses += player.totals.defuses;
        accumulator.entryKills += player.totals.entryKills;
        accumulator.entryDeaths += player.totals.entryDeaths;
        accumulator.headshotKills += player.totals.headshotKills;
        accumulator.damage += player.totals.damage;
        accumulator.clutchWon += player.totals.clutches.won;
        accumulator.clutchAttempts += player.totals.clutches.attempts;
        return accumulator;
      }, { kills: 0, deaths: 0, assists: 0, plants: 0, defuses: 0, entryKills: 0, entryDeaths: 0, headshotKills: 0, damage: 0, clutchWon: 0, clutchAttempts: 0 });
      totals.entrySuccessPercent = percent(totals.entryKills, totals.entryKills + totals.entryDeaths, 0);
      totals.headshotPercent = percent(totals.headshotKills, totals.kills, 0);
      // Takım ADR: round başına, oyuncu başına ortalama hasar (oyuncu tablosuyla karşılaştırılabilir).
      totals.adr = isAvailable(availability.damage) && roundsPlayed && members.length
        ? Number(safeDiv(totals.damage, roundsPlayed * members.length, 0).toFixed(1))
        : null;
      return {
        id: team.id,
        name: team.name,
        score: scoreByTeam.get(team.id) || 0,
        players: members,
        sides: team.sides,
        totals
      };
    }).filter((team) => team.players.length > 0 || team.score > 0);

    for (const round of rounds) {
      delete round.simulation;
    }

    const match = {
      map: str(demo?.header?.map_name),
      server: str(demo?.header?.server_name),
      file: str(demo?.file),
      durationSeconds: num(demo?.durationSeconds) ?? (maxTick / tickRate),
      tickRate,
      roundsPlayed,
      maxTick,
      score: Object.fromEntries(scoreByTeam),
      scoreBySide: rounds.length
        ? { T: rounds.filter((round) => round.winnerSide === 'T').length, CT: rounds.filter((round) => round.winnerSide === 'CT').length }
        : { T: 0, CT: 0 },
      sampleStep: num(demo?.sampleStep)
    };

    return {
      schemaVersion: MODEL_SCHEMA_VERSION,
      ready: true,
      reason: null,
      match,
      availability,
      teams,
      players,
      playerOrder: [...playerIndex.keys()],
      rounds,
      events: {
        kills,
        damage,
        shots,
        impacts: [],
        utility: utilityEvents,
        blinds,
        bomb: bombEvents
      },
      notes,
      config,
      meta: {
        sideSource: sidesInfo.source,
        outcomeSource: rounds.length ? rounds[0].outcomeSource : 'unknown'
      }
    };
  }

  const GENERIC_TEAM_NAME = /^(t|ct|terrorist|terrorists|counter[- _]?terrorist|counter[- _]?terrorists)$/i;

  function teamNamesFor(demo, components) {
    const nameBySteamId = new Map();
    for (const player of demo?.players || []) {
      const steamId = normalizeSteamId(player?.steamid);
      const name = str(player?.team_name);
      if (steamId && name && !GENERIC_TEAM_NAME.test(name)) nameBySteamId.set(steamId, name);
    }
    return components.map((members, index) => {
      const votes = new Map();
      for (const steamId of members) {
        const name = nameBySteamId.get(steamId);
        if (!name) continue;
        votes.set(name, (votes.get(name) || 0) + 1);
      }
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      return winner ? winner[0] : `Takım ${index + 1}`;
    });
  }

  /*
   * Takım üyeliği union-find ile çıkarılır: aynı roundda aynı tarafta olan
   * oyuncular aynı takımdır. Devre arasında taraf değişse de takım kimliği
   * sabit kalır (skor takım bazında tutulur).
   */
  function deriveTeams(demo, sidesByRound) {
    const parent = new Map();
    const find = (value) => {
      let root = value;
      while (parent.get(root) !== root) {
        root = parent.get(root);
      }
      let current = value;
      while (parent.get(current) !== root) {
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
      }
      return root;
    };
    const union = (a, b) => {
      const left = find(a);
      const right = find(b);
      if (left !== right) parent.set(left, right);
    };

    for (const sides of sidesByRound) {
      for (const steamId of sides.keys()) if (!parent.has(steamId)) parent.set(steamId, steamId);
    }
    for (const sides of sidesByRound) {
      const groups = new Map();
      for (const [steamId, team] of sides) {
        if (team !== 2 && team !== 3) continue;
        if (!groups.has(team)) groups.set(team, []);
        groups.get(team).push(steamId);
      }
      for (const members of groups.values()) {
        for (let i = 1; i < members.length; i += 1) union(members[0], members[i]);
      }
    }

    const components = new Map();
    for (const steamId of parent.keys()) {
      const root = find(steamId);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(steamId);
    }
    const sorted = [...components.values()].sort((a, b) => b.length - a.length || String(a[0]).localeCompare(String(b[0])));
    const names = teamNamesFor(demo, sorted);

    const teams = sorted.map((members, index) => ({
      id: `team-${index + 1}`,
      name: names[index],
      players: [...members].sort(),
      sides: { T: 0, CT: 0 }
    }));

    const teamOfPlayer = new Map();
    for (const team of teams) {
      for (const steamId of team.players) teamOfPlayer.set(steamId, team.id);
    }

    const roundTeams = sidesByRound.map((sides) => {
      const votes = { 2: new Map(), 3: new Map() };
      for (const [steamId, team] of sides) {
        const teamId = teamOfPlayer.get(steamId);
        if (!teamId || (team !== 2 && team !== 3)) continue;
        votes[team].set(teamId, (votes[team].get(teamId) || 0) + 1);
      }
      const pick = (bucket) => [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return { 2: pick(votes[2]), 3: pick(votes[3]) };
    });

    for (const sides of sidesByRound) {
      for (const [steamId, team] of sides) {
        const side = sideFromTeamNumber(team);
        const teamId = teamOfPlayer.get(steamId);
        if (!side || !teamId) continue;
        const entry = teams.find((team) => team.id === teamId);
        if (entry) entry.sides[side] += 1;
      }
    }

    return {
      teams,
      teamOfPlayer,
      teamById: new Map(teams.map((team) => [team.id, team])),
      roundTeams
    };
  }

  function collectUtilityEvents(demo) {
    const utility = demo?.utility || {};
    const pairs = [
      ['smokegrenade_detonate', utility.smokeStarts],
      ['smokegrenade_expired', utility.smokeEnds],
      ['inferno_startburn', utility.infernoStarts],
      ['inferno_expire', utility.infernoEnds],
      ['hegrenade_detonate', utility.heDetonates],
      ['flashbang_detonate', utility.flashDetonates],
      ['decoy_started', utility.decoyStarts],
      ['decoy_detonate', utility.decoyEnds]
    ];
    const result = [];
    for (const [name, rows] of pairs) {
      for (const raw of rows || []) result.push(normalizeUtilityEvent(raw, name));
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Filtreleme / görünüm yardımcıları
   * ------------------------------------------------------------------ */

  function playerRows(model, options = {}) {
    if (!model?.ready) return [];
    const { round = 'all', side = 'all' } = options;
    const roundIndex = round === 'all' ? -1 : model.rounds.findIndex((entry) => Number(entry.number) === Number(round));

    const matchesSide = (player) => {
      if (side === 'all') return true;
      if (roundIndex >= 0) {
        const roster = model.rounds[roundIndex]?.roster;
        if (roster?.[side]?.length) return roster[side].includes(player.steamId);
      }
      return player.side === side;
    };

    const rows = model.playerOrder
      .map((steamId) => model.players[steamId])
      .filter((player) => Boolean(player))
      .filter(matchesSide);

    return rows.map((player) => {
      const totals = { ...player.totals };
      if (round !== 'all') {
        const row = player.rounds[String(round)] || { kills: 0, deaths: 0, assists: 0, damage: 0, headshotKills: 0, survived: true };
        totals.kills = row.kills;
        totals.deaths = row.deaths;
        totals.assists = row.assists;
        totals.damage = row.damage;
        totals.headshotKills = row.headshotKills;
        totals.headshotPercent = percent(row.headshotKills, row.kills, 0);
        totals.kd = Number(safeDiv(row.kills, row.deaths, row.kills).toFixed(2));
        totals.adr = Number(row.damage.toFixed(1));
      }
      const roundSide = roundIndex >= 0
        ? (model.rounds[roundIndex].roster.T.includes(player.steamId) ? 'T'
          : model.rounds[roundIndex].roster.CT.includes(player.steamId) ? 'CT' : '')
        : player.side;
      return {
        steamId: player.steamId,
        name: player.name || player.steamId,
        side: roundSide || player.side,
        team: player.teamName || player.side,
        teamId: player.teamId,
        ...totals
      };
    });
  }

  function roundRows(model) {
    if (!model?.ready) return [];
    return model.rounds.map((round) => ({
      number: round.number,
      index: round.index,
      startTick: round.startTick,
      endTick: round.endTick,
      durationSeconds: round.durationSeconds,
      winnerSide: round.winnerSide,
      reason: round.reason,
      outcomeSource: round.outcomeSource,
      kills: round.kills.length,
      bombPlanted: round.bombPlanted,
      bombDefused: round.bombDefused,
      bombExploded: round.bombExploded,
      survivors: round.survivors,
      scoreAfter: round.scoreAfter,
      firstKill: round.entryKill,
      clutch: round.clutch
    }));
  }

  return {
    MODEL_SCHEMA_VERSION,
    DEFAULTS,
    buildMatchModel,
    emptyModel,
    playerRows,
    roundRows,
    buildSidesByRound,
    simulateRound,
    frameIndexAtOrAfter
  };
});
