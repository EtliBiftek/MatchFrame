/*
 * Utility analizi (Aşama 5'in hesap katmanı).
 *
 * Girdi: buildMatchModel() çıktısı (bkz. docs/ANALYSIS-MODEL.md).
 * Çıktı: buildUtilityModel() -> utility ekranının doğrudan render edebileceği model.
 *
 * Kurallar:
 *   - Sadece gerçek event'ler kullanılır; eksik veri için tahmin üretilmez.
 *   - Bir metrik hesaplanamıyorsa null döner ve availability 'partial'/'unavailable' olur.
 *   - Flash bağlama (player_blind.attacker yoksa) son flashbang_detonate sahibine yapılır.
 *     Bu çıkarım yapıldıysa player.flash.attributedByFallback > 0 ve confidence düşer.
 *   - Smoke süresi sadece smokegrenade_expired/effect_end varsa bilinir.
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


  const SCHEMA_VERSION = 2;
  const FALLBACK_FLASH_WINDOW_TICKS = 4 * 64; // çıkarım penceresi (4 sn @64 tick)

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */
  function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

  const GRENADE_KEYS = ['smoke', 'flash', 'he', 'molotov', 'decoy'];

  /* Inventory item adları -> model kind'leri (weapon_flashbang -> flash) */
  const INVENTORY_KEY_ALIAS = {
    flash: 'flash', flashbang: 'flash',
    smoke: 'smoke', smokegrenade: 'smoke',
    he: 'he', hegrenade: 'he',
    molotov: 'molotov', incgrenade: 'molotov', inferno: 'molotov', firebomb: 'molotov',
    decoy: 'decoy'
  };

  function emptyCounts() {
    return { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0, total: 0 };
  }

  function addCount(counts, key, amount = 1) {
    if (!counts || !(key in counts)) return;
    counts[key] += amount;
    if ('total' in counts) counts.total += amount;
  }

  function ratio(numerator, denominator) {
    const top = num(numerator);
    const bottom = num(denominator);
    if (top == null || bottom == null || bottom === 0) return null;
    return (top / bottom) * 100;
  }

  function round2(value) {
    if (value == null || !Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
  }

  function isAvailable(dataset) {
    return !(dataset && dataset.available === false);
  }

  function availabilityLevel(dataset, extra) {
    if (!isAvailable(dataset)) return 'unavailable';
    if (extra && extra.partial) return 'partial';
    return 'full';
  }

  /* Frame state'inden grenade sayımı (hem string hem obje inventory destekler). */
  function inventoryGrenades(inventory) {
    const counts = { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0, total: 0 };
    if (!Array.isArray(inventory)) return counts;
    for (const item of inventory) {
      const name = typeof item === 'string'
        ? item
        : String((item && (item.name || item.item_name || item.weapon_name || item.itemid)) || '');
      if (!name) continue;
      const key = INVENTORY_KEY_ALIAS[common.normalizeWeapon(name).key];
      if (key) {
        counts[key] += 1;
        counts.total += 1;
      }
    }
    return counts;
  }

  /*
   * Verilen tick'ten önceki (veya eşit) en yakın frame'i bulur.
   * model.meta.frameCount 0 ise null döner.
   */
  function frameAtOrBefore(frames, tick) {
    if (!Array.isArray(frames) || !frames.length) return null;
    let best = null;
    for (const frame of frames) {
      const frameTick = num(frame?.tick);
      if (frameTick == null || frameTick > tick) continue;
      if (!best || frameTick > best.tick) best = frame;
    }
    return best;
  }

  function playerStateAt(frame, steamId) {
    if (!frame || !Array.isArray(frame.players)) return null;
    return frame.players.find((state) => String(state?.steamid ?? '') === String(steamId)) || null;
  }

  /* ------------------------------------------------------------------ *
   * buildUtilityModel
   * ------------------------------------------------------------------ */
  function buildUtilityModel(model, options = {}) {
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      available: false,
      availability: {
        utility: 'unavailable',
        blinds: 'unavailable',
        damage: 'unavailable',
        frames: 'unavailable',
        smokes: 'unavailable',
        flashes: 'unavailable',
        molotovs: 'unavailable'
      },
      warnings: [],
      map: null,
      roundCount: 0,
      rounds: [],
      players: [],
      totals: {
        thrown: emptyCounts(),
        flash: { thrown: 0, enemiesBlinded: 0, teammatesBlinded: 0, blindSeconds: 0, assists: 0, wasted: 0 },
        smoke: { thrown: 0, activeSeconds: 0, expireSecondsKnown: 0, expireSecondsUnknown: 0, assists: 0 },
        molotov: { thrown: 0, burnSeconds: 0, damage: 0, playersBurned: 0 },
        he: { thrown: 0, damage: 0, playersHit: 0, wasted: 0, playersPerThrow: null, avgDamagePerVictim: null }
      },
      limits: { maxSmokeSeconds: 18, flashAttributionWindowSeconds: 4 }
    };

    if (!model || !model.events) return empty;

    const events = model.events || {};
    // Frame verisi (inventory ölçümü için) modele kopyalanmaz; ayrıca geçilir.
    const frames = options.frames || events.frames || null;
    const availability = model.availability || {};
    const utilityEvents = events.utility || [];
    const blindEvents = events.blinds || [];
    const damageEvents = events.damage || [];
    const killEvents = events.kills || [];
    const roundCount = (model.rounds || []).length || 1;
    const tickRate = num(model.match?.tickRate) || 64;
    const warnings = [];

    const utilityAvailable = isAvailable(availability.utility) && utilityEvents.length > 0;
    const blindsAvailable = isAvailable(availability.blinds) && blindEvents.length > 0;
    const damageAvailable = isAvailable(availability.damage) && damageEvents.length > 0;
    const framesAvailable = Array.isArray(frames) && frames.length > 0;

    if (!utilityAvailable) {
      const reason = availability.utility?.reason || 'Utility eventleri bu demo için parse edilmedi.';
      return { ...empty, warnings: [reason] };
    }

    /* --- Flash bağlama ---------------------------------------------- */
    const players = (model.playerOrder && model.playerOrder.length
      ? model.playerOrder
      : Object.keys(model.players || {})
    ).map((key) => model.players?.[key]).filter(Boolean);

    const sideOfPlayer = new Map();
    const nameOfPlayer = new Map();
    for (const player of players) {
      sideOfPlayer.set(String(player.steamId), player.teamId ?? null);
      nameOfPlayer.set(String(player.steamId), player.name || '');
    }

    const flashDetonations = utilityEvents
      .filter((event) => event.kind === 'flash')
      .sort((a, b) => a.tick - b.tick);

    let fallbackAttributions = 0;
    const blinds = blindEvents
      .map((event) => {
        const victimId = event.targetSteamId != null ? String(event.targetSteamId) : null;
        let attackerId = event.actorSteamId != null ? String(event.actorSteamId) : null;
        let inferred = false;
        if (!attackerId) {
          const window = FALLBACK_FLASH_WINDOW_TICKS * (tickRate / 64);
          const candidate = flashDetonations
            .filter((flash) => flash.tick <= event.tick && event.tick - flash.tick <= window)
            .pop();
          if (candidate?.actorSteamId != null) {
            attackerId = String(candidate.actorSteamId);
            inferred = true;
            fallbackAttributions += 1;
          }
        }
        return {
          tick: event.tick,
          round: event.round,
          roundIndex: event.roundIndex,
          attackerSteamId: attackerId,
          attackerName: attackerId != null ? (nameOfPlayer.get(attackerId) || event.actorName || '') : (event.actorName || ''),
          victimSteamId: victimId,
          victimName: victimId != null ? (nameOfPlayer.get(victimId) || event.targetName || '') : (event.targetName || ''),
          // player_blind.blind_duration saniye cinsindendir.
          duration: num(event.duration),
          durationSeconds: num(event.duration) != null ? Math.round(num(event.duration) * 10) / 10 : null,
          attackerTeamId: attackerId != null ? (sideOfPlayer.get(attackerId) ?? null) : null,
          victimTeamId: victimId != null ? (sideOfPlayer.get(victimId) ?? null) : null,
          inferred
        };
      })
      .filter((event) => event.victimSteamId != null);

    if (fallbackAttributions > 0) {
      warnings.push(
        `${fallbackAttributions} körlük kaydında attacker alanı yoktu; son flashbang_detonate sahibine bağlandı.`
      );
    }

    /* --- Oyuncu bazlı toplama --------------------------------------- */
    const rows = new Map();
    function rowFor(player) {
      const key = String(player.steamId);
      if (rows.has(key)) return rows.get(key);
      const row = {
        steamId: player.steamId,
        name: player.name,
        teamId: player.teamId ?? null,
        teamName: player.teamName ?? null,
        thrown: emptyCounts(),
        flash: {
          thrown: 0,
          enemiesBlinded: 0,
          teammatesBlinded: 0,
          selfBlinds: 0,
          blindSeconds: 0,
          enemiesBlindSeconds: 0,
          teammateBlindSeconds: 0,
          assists: 0,
          wasted: 0,
          attributedByFallback: 0,
          enemiesPerFlash: null,
          wastedRate: null,
          unknownSeconds: 0
        },
        smoke: {
          thrown: 0,
          activeSeconds: 0,
          expireSecondsKnown: 0,
          expireSecondsUnknown: 0,
          assists: 0,
          avgActiveSeconds: null,
          cutRate: null
        },
        molotov: { thrown: 0, burnSeconds: 0, expiringKnown: 0, damage: 0, playersBurned: 0, avgBurnSeconds: null },
        he: { thrown: 0, damage: 0, playersHit: 0, wasted: 0, playersPerThrow: null, wastedRate: null, avgDamagePerVictim: null },
        inventory: {
          available: framesAvailable,
          keptAtRoundEnd: emptyCounts(),
          roundsWithUtility: 0,
          deathsWithUtility: 0,
          grenadesWastedOnDeath: emptyCounts()
        },
        damage: {
          utilityDamage: player.totals?.utilityDamage ?? 0,
          beforeKill: 0,
          afterKill: 0,
          simple: 0,
          killsWithTrailingDamage: 0,
          deceptivePct: null
        },
        value: { perRound: null, perRoundThrown: null, perRoundDamage: null },
        confidence: 'high',
        rounds: []
      };
      rows.set(key, row);
      return row;
    }

    for (const player of players) rowFor(player);

    const roundRowsById = (model.rounds || []).map((round) => ({
      number: round.number,
      index: round.index,
      jumpTick: round.jumpTick ?? round.startTick,
      startTick: round.startTick,
      endTick: round.endTick,
      counts: emptyCounts(),
      byTeam: { T: emptyCounts(), CT: emptyCounts() }
    }));

    /* Thrown + expire/burn eşleştirmesi */
    const pending = new Map(); // `${steamId}:${kind}` -> [{tick, roundIndex, row, roundRow, team}]
    for (const event of utilityEvents) {
      const row = event.actorSteamId != null ? rows.get(String(event.actorSteamId)) : null;
      const roundIndex = event.roundIndex >= 0 ? event.roundIndex : null;
      const roundRow = roundIndex != null ? roundRowsById[roundIndex] : null;
      const side = roundIndex != null ? ((model.rounds?.[roundIndex]?.teamBySide
        ? Object.keys(model.rounds[roundIndex].teamBySide).find((key) => model.rounds[roundIndex].teamBySide[key] === (row?.teamId ?? null))
        : null) ?? null) : null;

      // Bitiş event'i (smokegrenade_expired / inferno_expire): süre ölçümü
      if (common.isUtilityEndEvent?.(event)) {
        const queue = pending.get(`${event.actorSteamId}:${event.kind}`) || [];
        const open = queue.shift();
        if (open && row) {
          const seconds = Math.max(0, (event.tick - open.tick) / tickRate);
          if (event.kind === 'smoke') {
            row.smoke.activeSeconds += seconds;
            row.smoke.expireSecondsKnown += 1;
            row.smoke.expireSecondsUnknown = Math.max(0, row.smoke.expireSecondsUnknown - 1);
          } else {
            row.molotov.burnSeconds += seconds;
            row.molotov.expiringKnown += 1;
          }
        }
        continue;
      }

      if (!GRENADE_KEYS.includes(event.kind)) continue;
      if (!common.isUtilityThrowEvent(event)) continue; // expire/fade tekrar sayılmaz
      if (!row) continue;
      addCount(row.thrown, event.kind);
      if (roundRow) {
        addCount(roundRow.counts, event.kind);
        if (side && roundRow.byTeam[side]) addCount(roundRow.byTeam[side], event.kind);
      }
      if (event.kind === 'flash') row.flash.thrown += 1;
      if (event.kind === 'he') row.he.thrown += 1;
      if (event.kind === 'smoke') {
        row.smoke.thrown += 1;
        row.smoke.expireSecondsUnknown += 1;
      }
      if (event.kind === 'molotov') row.molotov.thrown += 1;
      const key = `${event.actorSteamId}:${event.kind}`;
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push({ tick: event.tick, roundIndex });
    }

    // Kapanmayan smoke/molotov: expire yok -> süre bilinmiyor (null, 0 değil!)
    for (const row of rows.values()) {
      row.smoke.avgActiveSeconds = row.smoke.expireSecondsKnown > 0
        ? row.smoke.activeSeconds / row.smoke.expireSecondsKnown
        : null;
      row.smoke.cutRate = ratio(row.smoke.expireSecondsUnknown, row.smoke.thrown);
      row.molotov.avgBurnSeconds = row.molotov.expiringKnown > 0
        ? row.molotov.burnSeconds / row.molotov.expiringKnown
        : null;
    }

    /* Blind sonuçları */
    for (const blind of blinds) {
      const row = blind.attackerSteamId != null ? rows.get(blind.attackerSteamId) : null;
      if (!row) continue;
      const teammate = blind.attackerTeamId != null && blind.attackerTeamId === blind.victimTeamId;
      const self = blind.attackerSteamId === blind.victimSteamId;
      const seconds = blind.durationSeconds ?? 0;
      if (blind.inferred) row.flash.attributedByFallback += 1;
      if (blind.durationSeconds == null) row.flash.unknownSeconds += 1;
      if (self) {
        row.flash.selfBlinds += 1;
        row.flash.blindSeconds += seconds;
      } else if (teammate) {
        row.flash.teammatesBlinded += 1;
        row.flash.teammateBlindSeconds += seconds;
        row.flash.blindSeconds += seconds;
      } else {
        row.flash.enemiesBlinded += 1;
        row.flash.enemiesBlindSeconds += seconds;
        row.flash.blindSeconds += seconds;
      }
    }

    /* Utility hasarı (HE + molotov + kendine zarar) */
    const damagedPairs = new Set();
    for (const event of damageEvents) {
      const kind = common.utilityDamageKind?.(event.weapon) || common.utilityDamageKind?.(event.raw?.weapon);
      if (!kind) continue;
      const attackerId = event.actorSteamId != null ? String(event.actorSteamId) : null;
      const row = attackerId != null ? rows.get(attackerId) : null;
      const victimId = event.targetSteamId != null ? String(event.targetSteamId) : null;
      const damage = num(event.damage) || 0;
      if (!row) continue;
      if (kind === 'he') {
        row.he.damage += damage;
        if (victimId && victimId !== attackerId && !damagedPairs.has(`he:${attackerId}:${victimId}`)) {
          damagedPairs.add(`he:${attackerId}:${victimId}`);
          row.he.playersHit += 1;
        }
      }
      if (kind === 'molotov') {
        row.molotov.damage += damage;
        if (victimId && !damagedPairs.has(`mo:${attackerId}:${victimId}`)) {
          damagedPairs.add(`mo:${attackerId}:${victimId}`);
          row.molotov.playersBurned += 1;
        }
      }
    }

    for (const row of rows.values()) {
      row.flash.wasted = Math.max(0, row.flash.thrown - row.flash.enemiesBlinded - row.flash.teammatesBlinded);
      row.flash.enemiesPerFlash = row.flash.thrown > 0 ? row.flash.enemiesBlinded / row.flash.thrown : null;
      row.flash.wastedRate = ratio(row.flash.wasted, row.flash.thrown);
      row.he.wasted = Math.max(0, row.he.thrown - row.he.playersHit);
      row.he.playersPerThrow = row.he.thrown > 0 ? row.he.playersHit / row.he.thrown : null;
      row.he.wastedRate = ratio(row.he.wasted, row.he.thrown);
      row.he.avgDamagePerVictim = row.he.playersHit > 0 ? row.he.damage / row.he.playersHit : null;
    }

    /* Flash assist: player_death.assistedflash true olan kill'ler,
       aynı round'da flash atan (ve mağdurun takım arkadaşı olmayan) oyunculara paylaştırılmaz;
       sadece round bazlı sayım olarak raporlanır (assist sahibi eventte güvenilir değil). */
    const flashAssistRounds = new Map();
    for (const kill of killEvents) {
      if (!kill.assistedFlash || kill.round == null) continue;
      flashAssistRounds.set(Number(kill.round), (flashAssistRounds.get(Number(kill.round)) || 0) + 1);
    }
    let flashAssistsTotal = 0;
    for (const roundRow of roundRowsById) {
      roundRow.flashAssists = flashAssistRounds.get(Number(roundRow.number)) || 0;
      flashAssistsTotal += roundRow.flashAssists;
    }

    /* Aldatıcı hasar: ölümden sonra düşen hasar (≤4 sn) */
    const window = 4 * tickRate;
    const killsByPair = new Map();
    for (const kill of killEvents) {
      const attackerId = kill.actorSteamId != null ? String(kill.actorSteamId) : null;
      const victimId = kill.targetSteamId != null ? String(kill.targetSteamId) : null;
      if (!attackerId || !victimId) continue;
      const key = `${attackerId}:${victimId}`;
      if (!killsByPair.has(key)) killsByPair.set(key, []);
      killsByPair.get(key).push(kill.tick);
    }

    const trailingKillKeys = new Set();
    for (const event of damageEvents) {
      const attackerId = event.actorSteamId != null ? String(event.actorSteamId) : null;
      const victimId = event.targetSteamId != null ? String(event.targetSteamId) : null;
      const row = attackerId != null ? rows.get(attackerId) : null;
      if (!attackerId || !victimId || !row) continue;
      const damage = num(event.damage) || 0;
      if (damage <= 0) continue;
      const ticks = killsByPair.get(`${attackerId}:${victimId}`) || [];
      const deathTick = ticks
        .filter((tick) => tick >= event.tick - window && tick <= event.tick + window)
        .sort((a, b) => Math.abs(a - event.tick) - Math.abs(b - event.tick))[0];
      if (deathTick == null) {
        row.damage.simple += damage;
        continue;
      }
      if (event.tick > deathTick) {
        row.damage.afterKill += damage;
        trailingKillKeys.add(`${attackerId}:${victimId}:${deathTick}`);
      } else {
        row.damage.beforeKill += damage;
      }
    }
    for (const row of rows.values()) {
      row.damage.killsWithTrailingDamage = [...trailingKillKeys].filter((key) => key.startsWith(`${row.steamId}:`)).length;
      row.damage.deceptivePct = ratio(row.damage.afterKill, row.damage.beforeKill + row.damage.afterKill);
    }

    /* Inventory: round sonunda / ölüm anında elde kalan utility */
    if (framesAvailable) {
      for (const round of model.rounds || []) {
        const anchor = round.jumpTick ?? round.startTick;
        const frame = frameAtOrBefore(frames, anchor);
        if (!frame) continue;
        for (const player of players) {
          const row = rows.get(String(player.steamId));
          if (!row) continue;
          const state = playerStateAt(frame, player.steamId);
          const grenades = inventoryGrenades(state?.inventory);
          if (grenades.total > 0) row.inventory.roundsWithUtility += 1;
          for (const key of GRENADE_KEYS) row.inventory.keptAtRoundEnd[key] += grenades[key];
          row.inventory.keptAtRoundEnd.total += grenades.total;
        }
      }

      for (const kill of killEvents) {
        const victimId = kill.targetSteamId != null ? String(kill.targetSteamId) : null;
        const row = victimId != null ? rows.get(victimId) : null;
        if (!row) continue;
        const frame = frameAtOrBefore(frames, kill.tick);
        const state = playerStateAt(frame, victimId);
        const grenades = inventoryGrenades(state?.inventory);
        if (grenades.total > 0) row.inventory.deathsWithUtility += 1;
        for (const key of GRENADE_KEYS) row.inventory.grenadesWastedOnDeath[key] += grenades[key];
        row.inventory.grenadesWastedOnDeath.total += grenades.total;
      }
    }

    /* Player round bazlı özet + değer/güven */
    const utilityDamageByPlayerRound = new Map();
    for (const event of damageEvents) {
      const attackerId = event.attackerSteamId != null ? String(event.attackerSteamId) : null;
      if (!attackerId || event.round == null) continue;
      if (!common.utilityDamageKind?.(event.weapon) && !common.utilityDamageKind?.(event.raw?.weapon)) continue;
      const key = `${attackerId}:${Number(event.round)}`;
      utilityDamageByPlayerRound.set(key, (utilityDamageByPlayerRound.get(key) || 0) + (num(event.damage) || 0));
    }

    for (const player of players) {
      const row = rows.get(String(player.steamId));
      if (!row) continue;
      const roundKeys = new Set([
        ...Object.keys(player.rounds || {}),
        ...utilityEvents
          .filter((event) => event.actorSteamId != null && String(event.actorSteamId) === String(player.steamId) && event.round != null)
          .map((event) => String(Number(event.round)))
      ]);
      for (const key of [...roundKeys].sort((a, b) => Number(a) - Number(b))) {
        const counts = emptyCounts();
        for (const event of utilityEvents) {
          if (event.actorSteamId == null || String(event.actorSteamId) !== String(player.steamId)) continue;
          if (event.round == null || Number(event.round) !== Number(key)) continue;
          if (GRENADE_KEYS.includes(event.kind) && common.isUtilityThrowEvent(event)) addCount(counts, event.kind);
        }
        row.rounds.push({
          round: Number(key),
          thrown: counts,
          damage: utilityDamageByPlayerRound.get(`${String(player.steamId)}:${Number(key)}`) || 0
        });
      }
      row.rounds.sort((a, b) => a.round - b.round);

      row.value.perRound = row.thrown.total > 0 ? row.thrown.total / roundCount : null;
      row.value.perRoundThrown = row.value.perRound;
      row.value.perRoundDamage = row.damage.utilityDamage / roundCount;

      const flashPartial = row.flash.attributedByFallback > 0;
      const smokePartial = row.smoke.thrown > 0 && row.smoke.expireSecondsKnown === 0;
      row.confidence = !blindsAvailable && row.flash.thrown > 0 ? 'low'
        : (flashPartial || smokePartial) ? 'medium'
        : 'high';
    }

    /* Takım/round özetleri ve genel toplamlar */
    const totals = empty.totals;
    for (const row of rows.values()) {
      for (const key of GRENADE_KEYS) totals.thrown[key] += row.thrown[key];
      if (row === rows.values().next().value) totals.flash.assists = flashAssistsTotal;
      totals.thrown.total += row.thrown.total;
      totals.flash.thrown += row.flash.thrown;
      totals.flash.enemiesBlinded += row.flash.enemiesBlinded;
      totals.flash.teammatesBlinded += row.flash.teammatesBlinded;
      totals.flash.blindSeconds += row.flash.blindSeconds;
      totals.flash.wasted += row.flash.wasted;
      totals.smoke.thrown += row.smoke.thrown;
      totals.smoke.activeSeconds += row.smoke.activeSeconds;
      totals.smoke.expireSecondsKnown += row.smoke.expireSecondsKnown;
      totals.smoke.expireSecondsUnknown += row.smoke.expireSecondsUnknown;
      totals.molotov.thrown += row.molotov.thrown;
      totals.molotov.burnSeconds += row.molotov.burnSeconds;
      totals.molotov.damage += row.molotov.damage;
      totals.molotov.playersBurned += row.molotov.playersBurned;
      totals.he.thrown += row.he.thrown;
      totals.he.damage += row.he.damage;
      totals.he.playersHit += row.he.playersHit;
      totals.he.wasted += row.he.wasted;
    }

    totals.smoke.avgActiveSeconds = totals.smoke.expireSecondsKnown > 0
      ? totals.smoke.activeSeconds / totals.smoke.expireSecondsKnown
      : null;
    totals.molotov.avgBurnSeconds = totals.molotov.thrown > 0
      ? totals.molotov.burnSeconds / totals.molotov.thrown
      : null;
    totals.flash.enemiesPerFlash = totals.flash.thrown > 0 ? totals.flash.enemiesBlinded / totals.flash.thrown : null;
    totals.flash.wastedRate = ratio(totals.flash.wasted, totals.flash.thrown);
    totals.smoke.cutRate = ratio(totals.smoke.expireSecondsUnknown, totals.smoke.thrown);
    totals.he.playersPerThrow = totals.he.thrown > 0 ? totals.he.playersHit / totals.he.thrown : null;
    totals.he.avgDamagePerVictim = totals.he.playersHit > 0 ? totals.he.damage / totals.he.playersHit : null;

    const playerRows = [...rows.values()].sort((a, b) => (b.thrown.total - a.thrown.total) || String(a.name).localeCompare(String(b.name)));

    const result = {
      ...empty,
      available: true,
      availability: {
        utility: availabilityLevel(availability.utility, { partial: !isAvailable(availability.utility) }),
        blinds: blindsAvailable ? 'full' : availabilityLevel(availability.blinds),
        damage: damageAvailable ? 'full' : availabilityLevel(availability.damage),
        frames: framesAvailable ? 'full' : 'unavailable',
        smokes: totals.smoke.thrown === 0 ? 'unavailable'
          : (totals.smoke.expireSecondsKnown === 0 ? 'partial' : 'full'),
        flashes: totals.flash.thrown === 0 ? 'unavailable'
          : (blindsAvailable ? 'full' : 'partial'),
        molotovs: totals.molotov.thrown === 0 ? 'unavailable'
          : (damageAvailable ? 'full' : 'partial')
      },
      warnings,
      map: model.match?.map || null,
      tickRate,
      roundCount,
      rounds: roundRowsById,
      players: playerRows,
      totals,
      limits: {
        maxSmokeSeconds: 18,
        flashAttributionWindowSeconds: FALLBACK_FLASH_WINDOW_TICKS / 64
      }
    };

    if (!availability.impacts && model.availability?.impacts?.available === false) {
      result.warnings.push('shot/impact verisi yok: utility sonrası çatışma detayları sınırlı.');
    }
    return result;
  }

  return {
    SCHEMA_VERSION,
    buildUtilityModel,
    inventoryGrenades,
    frameAtOrBefore,
    playerStateAt,
    isUtilityThrowEvent: common.isUtilityThrowEvent,
    isUtilityEndEvent: common.isUtilityEndEvent
  };
}));
