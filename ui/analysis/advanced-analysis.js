/*
 * Gelişmiş analiz (Aşama 7.1) — hesap katmanı.
 *
 * Girdi: buildMatchModel() çıktısı.
 * Çıktılar:
 *   buildEconomyModel(model)     — round bazlı takım/oyuncu ekonomisi (item_purchase)
 *   buildSideSplitModel(model)   — T/CT taraf dağılımı (takım + oyuncu)
 *   buildMomentumModel(model)    — round bazında skor farkı ve seriler
 *   buildMatchHeatmap(model)     — maç geneli kill/ölüm noktaları
 *   buildOpeningDuels(model)     — entry (opening) düello dağılımı
 *
 * Kurallar:
 *   - Tahmin üretilmez: veri yoksa metrik null / availability 'unavailable'.
 *   - Satın alma eşikleri (eco/force/full) ürün kuralı değil, yapılandırılabilir analiz
 *     ayarıdır; varsayılanlar CS2 ekonomisine yaklaşık değerlerdir.
 *   - Ekipman değeri (loadout value) demo'dan okunamaz; yalnızca round içi harcama
 *     (`item_purchase.cost`) bilinir. Bu yüzden "ekipman değeri" yerine "harcama" denir.
 */
(function (root, factory) {
  'use strict';
  const analysis = (typeof module === 'object' && module.exports)
    ? Object.assign({}, require('./common.js'), require('./match-analysis.js'))
    : root.MF.analysis;
  const api = factory(analysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  const ns = (root.MF = root.MF || {});
  ns.analysis = Object.assign(ns.analysis || {}, api);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (common) {
  'use strict';

  const SCHEMA_VERSION = 1;

  const DEFAULTS = {
    // Round başı oyuncu başına harcama eşikleri ($)
    buy: { eco: 1500, full: 4000 },
    pistolRoundNumbers: [1, 13] // CS2'de pistol round'ları (bilgi amaçlı)
  };

  function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function ratio(top, bottom) {
    if (top == null || bottom == null || bottom === 0) return null;
    return (top / bottom) * 100;
  }
  function mean(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  function isAvailable(dataset) { return !(dataset && dataset.available === false); }

  function playerList(model) {
    return (model.playerOrder && model.playerOrder.length
      ? model.playerOrder
      : Object.keys(model.players || {})
    ).map((key) => model.players?.[key]).filter(Boolean);
  }

  function sideOfSteamId(round, steamId) {
    if (!round) return '';
    if (round.roster?.T?.includes(steamId)) return 'T';
    if (round.roster?.CT?.includes(steamId)) return 'CT';
    return '';
  }

  function emptySideStats() {
    return {
      rounds: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, damage: 0,
      headshotKills: 0, entryKills: 0, entryDeaths: 0, tradeKills: 0, tradedDeaths: 0,
      clutchAttempts: 0, clutchWon: 0, spend: 0, buys: 0, survived: 0
    };
  }

  function finalizeSideStats(stats) {
    return {
      ...stats,
      winPercent: ratio(stats.wins, stats.rounds),
      adr: stats.rounds > 0 ? stats.damage / stats.rounds : null,
      kd: stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills,
      headshotPercent: ratio(stats.headshotKills, stats.kills),
      avgSpend: stats.rounds > 0 ? stats.spend / stats.rounds : null
    };
  }

  /* ------------------------------------------------------------------ *
   * 1) Ekonomi
   * ------------------------------------------------------------------ */
  function classifyBuy(spendPerPlayer, thresholds, roundNumber) {
    if (spendPerPlayer == null) return 'unknown';
    if ((thresholds.pistolRoundNumbers || []).includes(Number(roundNumber))) {
      return spendPerPlayer >= thresholds.buy.eco ? 'force' : 'pistol';
    }
    if (spendPerPlayer < thresholds.buy.eco) return 'eco';
    if (spendPerPlayer < thresholds.buy.full) return 'force';
    return 'full';
  }

  function buildEconomyModel(model, options = {}) {
    const config = { ...DEFAULTS, ...(options.config || {}), buy: { ...DEFAULTS.buy, ...(options.config?.buy || {}) } };
    const unavailable = {
      schemaVersion: SCHEMA_VERSION,
      available: false,
      availability: { purchases: 'unavailable' },
      warnings: [],
      roundCount: 0,
      thresholds: config,
      rounds: [],
      teams: [],
      players: [],
      totals: { spend: 0, buys: 0, eco: 0, force: 0, full: 0, pistol: 0 }
    };

    if (!model?.ready || !model.events) return unavailable;
    if (!isAvailable(model.availability?.purchases)) {
      return {
        ...unavailable,
        warnings: [model.availability?.purchases?.error || 'item_purchase verisi yok: ekonomi hesaplanamadı.']
      };
    }

    const rounds = (model.rounds || []).map((round) => {
      const sideSpend = { T: 0, CT: 0 };
      const sideBuys = { T: 0, CT: 0 };
      const sideCounts = { T: 0, CT: 0 };
      for (const player of playerList(model)) {
        const side = sideOfSteamId(round, player.steamId) || player.side || '';
        if (!sideSpend || !(side in sideSpend)) continue;
        const row = player.rounds?.[String(round.number)] || null;
        const spend = row?.spend || 0;
        sideSpend[side] += spend;
        sideBuys[side] += row?.buys || 0;
        sideCounts[side] += 1;
      }
      const perSide = {};
      for (const side of ['T', 'CT']) {
        const count = sideCounts[side] || 0;
        const spendPerPlayer = count > 0 ? sideSpend[side] / count : null;
        perSide[side] = {
          spend: sideSpend[side],
          buys: sideBuys[side],
          spendPerPlayer,
          buy: classifyBuy(spendPerPlayer, config, round.number),
          won: round.winnerSide === side
        };
      }
      const spendDelta = (sideSpend.T ?? 0) - (sideSpend.CT ?? 0);
      return {
        number: round.number,
        index: round.index,
        jumpTick: round.jumpTick ?? round.startTick,
        winnerSide: round.winnerSide || '',
        reason: round.reason || '',
        outcomeSource: round.outcomeSource,
        spend: round.economy?.spend || 0,
        buys: round.economy?.buys || 0,
        bySide: perSide,
        spendDelta,
        wonByHigherSpend: round.winnerSide
          ? (perSide[round.winnerSide]?.spend ?? 0) >= (perSide[round.winnerSide === 'T' ? 'CT' : 'T']?.spend ?? 0)
          : null
      };
    });

    // Takım bazında özet
    const teamsById = new Map();
    for (const team of model.teams || []) {
      teamsById.set(team.id, {
        id: team.id,
        name: team.name,
        spend: 0,
        buys: 0,
        rounds: 0,
        byBuy: { pistol: 0, eco: 0, force: 0, full: 0, unknown: 0 },
        winsByBuy: { pistol: 0, eco: 0, force: 0, full: 0, unknown: 0 },
        players: []
      });
    }

    for (const round of rounds) {
      for (const side of ['T', 'CT']) {
        const teamId = model.rounds[round.index]?.teamBySide?.[side];
        const entry = teamsById.get(teamId);
        if (!entry) continue;
        const sideData = round.bySide[side];
        entry.spend += sideData.spend;
        entry.buys += sideData.buys;
        entry.rounds += 1;
        entry.byBuy[sideData.buy] = (entry.byBuy[sideData.buy] || 0) + 1;
        if (sideData.won) entry.winsByBuy[sideData.buy] = (entry.winsByBuy[sideData.buy] || 0) + 1;
      }
    }

    // Oyuncu bazında
    const players = playerList(model).map((player) => {
      const roundRows = Object.keys(player.rounds || {});
      let spend = 0;
      let buys = 0;
      let ecoRounds = 0;
      let fullRounds = 0;
      for (const key of roundRows) {
        const row = player.rounds[key];
        spend += row?.spend || 0;
        buys += row?.buys || 0;
        if ((row?.spend || 0) < config.buy.eco) ecoRounds += 1;
        else if ((row?.spend || 0) >= config.buy.full) fullRounds += 1;
      }
      const roundsPlayed = roundRows.length || 1;
      return {
        steamId: player.steamId,
        name: player.name,
        teamId: player.teamId ?? null,
        teamName: player.teamName ?? null,
        spend,
        buys,
        avgSpend: roundsPlayed > 0 ? spend / roundsPlayed : null,
        ecoRounds,
        fullRounds,
        roundsPlayed,
        economy: { ...(player.totals?.economy || {}) }
      };
    }).sort((a, b) => b.spend - a.spend);

    const teams = [...teamsById.values()].map((team) => ({
      ...team,
      avgSpend: team.rounds > 0 ? team.spend / team.rounds : null,
      roundsWithData: team.rounds
    }));

    const totals = rounds.reduce((accumulator, round) => {
      accumulator.spend += round.spend;
      accumulator.buys += round.buys;
      for (const side of ['T', 'CT']) accumulator[round.bySide[side].buy] += 1;
      return accumulator;
    }, { spend: 0, buys: 0, eco: 0, force: 0, full: 0, pistol: 0, unknown: 0 });

    return {
      schemaVersion: SCHEMA_VERSION,
      available: true,
      availability: { purchases: 'full' },
      warnings: [],
      roundCount: rounds.length,
      thresholds: config,
      rounds,
      teams,
      players,
      totals
    };
  }

  /* ------------------------------------------------------------------ *
   * 2) Taraf dağılımı (T / CT)
   * ------------------------------------------------------------------ */
  function buildSideSplitModel(model) {
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      available: false,
      availability: { rounds: 'unavailable' },
      warnings: [],
      teams: [],
      players: [],
      totals: { T: finalizeSideStats(emptySideStats()), CT: finalizeSideStats(emptySideStats()) }
    };
    if (!model?.ready || !model.events) return empty;
    if (!(model.rounds || []).length) return { ...empty, warnings: ['Round verisi yok: taraf dağılımı hesaplanamadı.'] };

    const teamSides = new Map();   // `${teamId}:${side}` -> stats
    const playerSides = new Map(); // `${steamId}:${side}` -> stats
    const playerMeta = new Map();

    for (const player of playerList(model)) {
      playerMeta.set(String(player.steamId), player);
    }

    const ensure = (map, key) => {
      if (!map.has(key)) map.set(key, emptySideStats());
      return map.get(key);
    };

    for (const round of model.rounds) {
      const winnerSide = round.winnerSide || '';
      for (const side of ['T', 'CT']) {
        const teamId = round.teamBySide?.[side];
        const roster = round.roster?.[side] || [];
        if (teamId) {
          const stats = ensure(teamSides, `${teamId}:${side}`);
          stats.rounds += 1;
          if (winnerSide === side) stats.wins += 1;
          else if (winnerSide) stats.losses += 1;
          const rosterSide = round.roster?.[side] || [];
          stats.kills += (round.kills || []).filter((kill) => kill.actorSteamId && rosterSide.includes(kill.actorSteamId) && !kill.suicide && !kill.teamKill).length;
          stats.deaths += (round.kills || []).filter((kill) => rosterSide.includes(kill.targetSteamId)).length;
          stats.damage += (round.damage || []).filter((event) => event.actorSteamId && rosterSide.includes(event.actorSteamId)).reduce((sum, event) => sum + (num(event.damage) || 0), 0);
          stats.headshotKills += (round.kills || []).filter((kill) => kill.headshot && rosterSide.includes(kill.actorSteamId) && !kill.suicide && !kill.teamKill).length;
        }

        for (const steamId of roster) {
          const key = String(steamId);
          const stats = ensure(playerSides, `${key}:${side}`);
          const row = playerMeta.get(key)?.rounds?.[String(round.number)] || null;
          stats.rounds += 1;
          if (winnerSide === side) stats.wins += 1;
          else if (winnerSide) stats.losses += 1;
          stats.kills += row?.kills || 0;
          stats.deaths += row?.deaths || 0;
          stats.assists += row?.assists || 0;
          stats.damage += row?.damage || 0;
          stats.headshotKills += row?.headshotKills || 0;
          stats.spend += row?.spend || 0;
          stats.buys += row?.buys || 0;
          if (row?.survived) stats.survived += 1;
        }
      }

      // Entry kill / clutch / trade taraf bazında
      const entry = round.entryKill;
      if (entry?.attackerSteamId) {
        const attackerSide = sideOfSteamId(round, entry.attackerSteamId);
        const victimSide = sideOfSteamId(round, entry.victimSteamId);
        if (attackerSide) {
          const key = `${String(entry.attackerSteamId)}:${attackerSide}`;
          if (playerSides.has(key)) playerSides.get(key).entryKills += 1;
          const teamId = round.teamBySide?.[attackerSide];
          if (teamId && teamSides.has(`${teamId}:${attackerSide}`)) teamSides.get(`${teamId}:${attackerSide}`).entryKills += 1;
        }
        if (victimSide) {
          const key = `${String(entry.victimSteamId)}:${victimSide}`;
          if (playerSides.has(key)) playerSides.get(key).entryDeaths += 1;
          const teamId = round.teamBySide?.[victimSide];
          if (teamId && teamSides.has(`${teamId}:${victimSide}`)) teamSides.get(`${teamId}:${victimSide}`).entryDeaths += 1;
        }
      }

      if (round.clutch?.playerSteamId) {
        const side = round.clutch.side || sideOfSteamId(round, round.clutch.playerSteamId);
        const key = `${String(round.clutch.playerSteamId)}:${side}`;
        if (playerSides.has(key)) {
          playerSides.get(key).clutchAttempts += 1;
          if (round.clutch.won) playerSides.get(key).clutchWon += 1;
        }
      }
    }

    const teams = (model.teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      T: finalizeSideStats(teamSides.get(`${team.id}:T`) || emptySideStats()),
      CT: finalizeSideStats(teamSides.get(`${team.id}:CT`) || emptySideStats())
    }));

    const players = [...playerMeta.values()].map((player) => ({
      steamId: player.steamId,
      name: player.name,
      teamId: player.teamId ?? null,
      teamName: player.teamName ?? null,
      T: finalizeSideStats(playerSides.get(`${String(player.steamId)}:T`) || emptySideStats()),
      CT: finalizeSideStats(playerSides.get(`${String(player.steamId)}:CT`) || emptySideStats())
    })).sort((a, b) => (b.T.kills + b.CT.kills) - (a.T.kills + a.CT.kills));

    const totals = {
      T: finalizeSideStats([...teamSides.entries()].filter(([key]) => key.endsWith(':T'))
        .reduce((accumulator, [, stats]) => accumulate(accumulator, stats), emptySideStats())),
      CT: finalizeSideStats([...teamSides.entries()].filter(([key]) => key.endsWith(':CT'))
        .reduce((accumulator, [, stats]) => accumulate(accumulator, stats), emptySideStats()))
    };

    return {
      schemaVersion: SCHEMA_VERSION,
      available: true,
      availability: { rounds: 'full' },
      warnings: [],
      teams,
      players,
      totals
    };
  }

  function accumulate(target, source) {
    for (const key of Object.keys(target)) target[key] += source[key] || 0;
    return target;
  }

  /* ------------------------------------------------------------------ *
   * 3) Momentum
   * ------------------------------------------------------------------ */
  function buildMomentumModel(model) {
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      available: false,
      warnings: [],
      rounds: [],
      longestStreak: { T: 0, CT: 0 },
      biggestLead: { diff: 0, round: null, side: null }
    };
    if (!model?.ready || !(model.rounds || []).length) {
      return { ...empty, warnings: ['Round verisi yok: momentum hesaplanamadı.'] };
    }

    const rounds = [];
    let streakSide = null;
    let streakLength = 0;
    let longestStreak = { T: 0, CT: 0 };
    let biggestLead = { diff: 0, round: null, side: null };

    for (const round of model.rounds) {
      const tId = round.teamBySide?.T;
      const ctId = round.teamBySide?.CT;
      const tScore = num(round.scoreAfter?.[tId]) ?? 0;
      const ctScore = num(round.scoreAfter?.[ctId]) ?? 0;
      const diff = tScore - ctScore;
      const winner = round.winnerSide || '';

      if (winner && winner === streakSide) streakLength += 1;
      else {
        streakSide = winner || null;
        streakLength = winner ? 1 : 0;
      }
      if (winner && streakLength > (longestStreak[winner] || 0)) longestStreak[winner] = streakLength;

      if (Math.abs(diff) > Math.abs(biggestLead.diff)) {
        biggestLead = { diff, round: round.number, side: diff > 0 ? 'T' : diff < 0 ? 'CT' : null };
      }

      rounds.push({
        number: round.number,
        index: round.index,
        winnerSide: winner,
        reason: round.reason || '',
        jumpTick: round.jumpTick ?? round.startTick,
        scoreT: tScore,
        scoreCT: ctScore,
        diff,
        streakSide: streakSide,
        streakLength
      });
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      available: rounds.length > 0,
      warnings: [],
      rounds,
      longestStreak,
      biggestLead
    };
  }

  /* ------------------------------------------------------------------ *
   * 4) Maç ısı haritası
   * ------------------------------------------------------------------ */
  function buildMatchHeatmap(model, options = {}) {
    const kills = model?.events?.kills || [];
    const points = [];
    let missing = 0;
    for (const kill of kills) {
      const attackerPoint = kill.attackerPosition
        ? { x: kill.attackerPosition.x, y: kill.attackerPosition.y }
        : null;
      const victimPoint = kill.position
        ? { x: kill.position.x, y: kill.position.y }
        : null;
      if (!attackerPoint && !victimPoint) {
        missing += 1;
        continue;
      }
      if (attackerPoint) {
        points.push({
          kind: 'kill',
          x: attackerPoint.x,
          y: attackerPoint.y,
          tick: kill.tick,
          round: kill.round,
          steamId: kill.actorSteamId,
          label: kill.actorName || '',
          weapon: kill.weaponLabel || kill.weapon
        });
      }
      if (victimPoint) {
        points.push({
          kind: 'death',
          x: victimPoint.x,
          y: victimPoint.y,
          tick: kill.tick,
          round: kill.round,
          steamId: kill.targetSteamId,
          label: kill.targetName || '',
          weapon: kill.weaponLabel || kill.weapon,
          headshot: Boolean(kill.headshot)
        });
      }
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      available: points.length > 0,
      availability: {
        kills: isAvailable(model?.availability?.kills) ? 'full' : 'unavailable',
        positions: points.length > 0 ? 'full' : 'unavailable'
      },
      warnings: points.length ? [] : ['Kill konumları bu demoda yok: ısı haritası çizilemiyor.'],
      points,
      missingPositions: missing,
      roundCount: (model?.rounds || []).length,
      limit: options.limit || 0
    };
  }

  /* ------------------------------------------------------------------ *
   * 5) Opening (entry) düellolar
   * ------------------------------------------------------------------ */
  function buildOpeningDuels(model) {
    const rounds = model?.rounds || [];
    const duels = [];
    for (const round of rounds) {
      const entry = round.entryKill;
      if (!entry?.attackerSteamId) continue;
      // Tam kill eventi (headshot / kör atış / trade bilgisi için)
      const kill = (round.kills || []).find((candidate) => candidate.isEntry
        && String(candidate.actorSteamId) === String(entry.attackerSteamId)
        && String(candidate.targetSteamId) === String(entry.victimSteamId)) || null;
      const attackerSide = sideOfSteamId(round, entry.attackerSteamId);
      const victimSide = sideOfSteamId(round, entry.victimSteamId);
      duels.push({
        round: round.number,
        index: round.index,
        tick: entry.tick,
        jumpTick: Math.max(0, entry.tick - 64),
        attackerSteamId: entry.attackerSteamId,
        attackerName: entry.attackerName || '',
        attackerSide,
        victimSteamId: entry.victimSteamId,
        victimName: entry.victimName || '',
        victimSide,
        weapon: kill?.weapon || '',
        weaponLabel: kill?.weaponLabel || entry.weapon || '',
        headshot: kill ? Boolean(kill.headshot) : null,
        attackerBlind: kill ? Boolean(kill.attackerBlind) : null,
        roundWonByAttackerSide: round.winnerSide ? round.winnerSide === attackerSide : null,
        traded: kill ? Boolean(kill.isTrade) : null
      });
    }

    const bySide = { T: { attempts: 0, won: 0, died: 0 }, CT: { attempts: 0, won: 0, died: 0 } };
    for (const duel of duels) {
      if (duel.attackerSide) {
        bySide[duel.attackerSide].attempts += 1;
        if (duel.roundWonByAttackerSide) bySide[duel.attackerSide].won += 1;
      }
      if (duel.victimSide) bySide[duel.victimSide].died += 1;
    }
    for (const side of ['T', 'CT']) {
      bySide[side].successPercent = ratio(bySide[side].won, bySide[side].attempts);
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      available: duels.length > 0,
      warnings: duels.length ? [] : ['Entry (ilk kill) verisi yok.'],
      duels,
      bySide,
      roundCount: rounds.length,
      roundsWithEntry: duels.length
    };
  }

  return {
    SCHEMA_VERSION,
    DEFAULTS,
    buildEconomyModel,
    buildSideSplitModel,
    buildMomentumModel,
    buildMatchHeatmap,
    buildOpeningDuels,
    classifyBuy,
    sideOfSteamId
  };
}));
