/*
 * Aim analizi (Aşama 6'nın hesap katmanı).
 *
 * Girdi: buildMatchModel() çıktısı + (opsiyonel) { frames: demo.frames }
 *        — frame verisi modele kopyalanmaz, ekran ayrıca geçirir.
 * Çıktı: buildAimModel() -> aim ekranının doğrudan render edebileceği model.
 *
 * Doğruluk sınırları (UI'da da gösterilir):
 *   - Visibility (raycast) doğrulaması YOK: reaction time yalnızca "görüş konisine
 *     giriş → ilk atış" arasıdır; kesin tepki süresi değildir → "potential".
 *   - Kamera yönü frame'lerdeki yaw/pitch'ten okunur (pitch pozitif = yukarı).
 *   - bullet_impact yoksa accuracy/isabet hesaplanmaz (null).
 *   - Konum yoksa mesafe ve crosshair hatası hesaplanmaz (null).
 *   - Tahmin üretilmez: veri yoksa metrik null, availability 'unavailable'.
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
    duelWindowSeconds: 12,     // kill'den önceki düello penceresi
    crosshair: { great: 2, ok: 5, weak: 10 },   // derece eşikleri (ürün kuralı değil, ayar)
    movingSpeedUnitsPerSecond: 60,
    fovHalfDegrees: 45,        // yatay görüş konisi yarısı (yaklaşık)
    maxDuelDistance: 4000      // birim
  };

  /* ------------------------------------------------------------------ *
   * Geometri yardımcıları (saf, test edilebilir)
   * ------------------------------------------------------------------ */
  function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  const DEG = Math.PI / 180;

  function distance3(a, b) {
    if (!a || !b) return null;
    const dx = (num(a.x) ?? 0) - (num(b.x) ?? 0);
    const dy = (num(a.y) ?? 0) - (num(b.y) ?? 0);
    const dz = (num(a.z) ?? 0) - (num(b.z) ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /*
   * Source motoru kamera açıları: yaw 0 -> +X, 90 -> +Y (derece).
   * pitch pozitif = yukarı bakış (demoparser alanına göre; işaret yanlışsa
   * dikey hata büyüklüğü değişir, yatay hata etkilenmez).
   */
  function forwardVector(yawDeg, pitchDeg) {
    const yaw = (num(yawDeg) ?? 0) * DEG;
    const pitch = (num(pitchDeg) ?? 0) * DEG;
    const cosPitch = Math.cos(pitch);
    return { x: cosPitch * Math.cos(yaw), y: cosPitch * Math.sin(yaw), z: Math.sin(pitch) };
  }

  function normalize3(vector) {
    const length = Math.sqrt((vector.x || 0) ** 2 + (vector.y || 0) ** 2 + (vector.z || 0) ** 2);
    if (!length) return null;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function directionBetween(from, to) {
    if (!from || !to) return null;
    return normalize3({
      x: (num(to.x) ?? 0) - (num(from.x) ?? 0),
      y: (num(to.y) ?? 0) - (num(from.y) ?? 0),
      z: (num(to.z) ?? 0) - (num(from.z) ?? 0)
    });
  }

  function angleBetweenDeg(a, b) {
    const first = normalize3(a);
    const second = normalize3(b);
    if (!first || !second) return null;
    const dot = Math.max(-1, Math.min(1, first.x * second.x + first.y * second.y + first.z * second.z));
    return Math.acos(dot) / DEG;
  }

  /*
   * Crosshair açı hatası: nişancının bakış yönü ile hedefe yön arasındaki açı (derece).
   * shooter: { x, y, z, yaw, pitch }, target: { x, y, z }
   */
  function crosshairErrorDeg(shooter, target) {
    if (!shooter || !target) return null;
    const forward = forwardVector(shooter.yaw, shooter.pitch);
    const toTarget = directionBetween(shooter, target);
    return angleBetweenDeg(forward, toTarget);
  }

  /* Hedef görüş konisinde mi? (3B açı, yatay yarı FOV kullanılır) */
  function isInViewCone(shooter, target, fovHalfDegrees = DEFAULTS.fovHalfDegrees) {
    const error = crosshairErrorDeg(shooter, target);
    if (error == null) return false;
    return error <= fovHalfDegrees;
  }

  /* İki frame arasındaki hız (birim/saniye). */
  function speedUnitsPerSecond(previous, next, tickRate = 64) {
    if (!previous || !next) return null;
    const deltaTicks = (num(next.tick) ?? 0) - (num(previous.tick) ?? 0);
    if (deltaTicks <= 0) return null;
    const distance = distance3(previous, next);
    if (distance == null) return null;
    return distance / (deltaTicks / tickRate);
  }

  /* ------------------------------------------------------------------ *
   * Frame erişimi
   * ------------------------------------------------------------------ */
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

  function frameAtOrAfter(frames, tick) {
    if (!Array.isArray(frames) || !frames.length) return null;
    let best = null;
    for (const frame of frames) {
      const frameTick = num(frame?.tick);
      if (frameTick == null || frameTick < tick) continue;
      if (!best || frameTick < best.tick) best = frame;
    }
    return best;
  }

  function stateOf(frame, steamId) {
    if (!frame || !Array.isArray(frame.players) || steamId == null) return null;
    const key = String(steamId);
    const row = frame.players.find((candidate) => String(candidate?.steamid ?? '') === key);
    if (!row) return null;
    return {
      steamId: key,
      tick: num(frame.tick),
      x: num(row.X), y: num(row.Y), z: num(row.Z),
      yaw: num(row.yaw), pitch: num(row.pitch),
      health: num(row.health),
      isAlive: row.is_alive == null ? true : Boolean(row.is_alive),
      teamNumber: num(row.team_num)
    };
  }

  /* ------------------------------------------------------------------ *
   * buildAimModel
   * ------------------------------------------------------------------ */
  function buildAimModel(model, options = {}) {
    const config = {
      ...DEFAULTS,
      ...(options.config || {}),
      crosshair: { ...DEFAULTS.crosshair, ...(options.config?.crosshair || {}) }
    };
    const unavailable = (reason) => ({
      schemaVersion: SCHEMA_VERSION,
      available: false,
      reason: reason || null,
      availability: {
        frames: 'unavailable', shots: 'unavailable', impacts: 'unavailable',
        damage: 'unavailable', kills: 'unavailable'
      },
      warnings: [],
      map: null,
      tickRate: 64,
      roundCount: 0,
      thresholds: config,
      players: [],
      duels: [],
      totals: emptyTotals()
    });

    if (!model || !model.events || !model.ready) {
      return unavailable(model ? 'Analiz modeli hazır değil' : 'Demo yüklenmedi');
    }

    const events = model.events || {};
    const frames = options.frames || null;
    const tickRate = num(model.match?.tickRate) || 64;
    const kills = events.kills || [];
    const damage = events.damage || [];
    const shots = events.shots || [];
    const impacts = events.impacts || [];
    const warnings = [];

    const framesAvailable = Array.isArray(frames) && frames.length > 0;
    const shotsAvailable = model.availability?.shots?.available !== false && shots.length > 0;
    const impactsAvailable = model.availability?.impacts?.available !== false && impacts.length > 0;
    const damageAvailable = model.availability?.damage?.available !== false && damage.length > 0;
    const killsAvailable = model.availability?.kills?.available !== false && kills.length > 0;

    if (!killsAvailable && !shotsAvailable) {
      return {
        ...unavailable('Bu demo aim metrikleri için gerekli player_death/weapon_fire verisini sağlamıyor.'),
        tickRate,
        map: model.match?.map || null,
        roundCount: (model.rounds || []).length,
        availability: {
          frames: framesAvailable ? 'full' : 'unavailable',
          shots: shotsAvailable ? 'full' : 'unavailable',
          impacts: impactsAvailable ? 'full' : 'unavailable',
          damage: damageAvailable ? 'full' : 'unavailable',
          kills: killsAvailable ? 'full' : 'unavailable'
        }
      };
    }

    const players = (model.playerOrder && model.playerOrder.length
      ? model.playerOrder
      : Object.keys(model.players || {})
    ).map((key) => model.players?.[key]).filter(Boolean);

    const rows = new Map();
    for (const player of players) {
      rows.set(String(player.steamId), {
        steamId: player.steamId,
        name: player.name,
        teamId: player.teamId ?? null,
        teamName: player.teamName ?? null,
        kills: player.totals?.kills ?? 0,
        deaths: player.totals?.deaths ?? 0,
        headshots: player.totals?.headshotKills ?? 0,
        headshotPercent: player.totals?.headshotPercent ?? 0,
        damage: player.totals?.damage ?? 0,
        adr: player.totals?.adr ?? null,
        shots: 0,
        impacts: 0,
        accuracy: null,
        avgKillDistance: null,
        distanceSamples: 0,
        movingShots: null,
        movingShotRate: null,
        crosshairErrorDeg: null,
        crosshairSamples: 0,
        potentialReactionMs: null,
        reactionSamples: 0,
        blindKills: 0,
        weapons: [],
        confidence: 'high'
      });
    }

    /* --- Atış / isabet ---------------------------------------------- */
    const shotsByPlayer = new Map();
    for (const shot of shots) {
      const key = shot.actorSteamId != null ? String(shot.actorSteamId) : null;
      if (!key) continue;
      if (!shotsByPlayer.has(key)) shotsByPlayer.set(key, []);
      shotsByPlayer.get(key).push(shot);
      const row = rows.get(key);
      if (row) row.shots += 1;
    }
    const impactsByPlayer = new Map();
    for (const impact of impacts) {
      const key = impact.actorSteamId != null ? String(impact.actorSteamId) : null;
      if (!key) continue;
      impactsByPlayer.set(key, (impactsByPlayer.get(key) || 0) + 1);
      const row = rows.get(key);
      if (row) row.impacts += 1;
    }
    if (impactsAvailable) {
      for (const row of rows.values()) {
        row.accuracy = row.shots > 0 ? (row.impacts / row.shots) * 100 : null;
      }
    } else {
      warnings.push('bullet_impact verisi yok: accuracy/isabet hesaplanmadı (sütunlar gizlendi).');
      for (const row of rows.values()) row.accuracy = null;
    }
    if (!shotsAvailable) {
      warnings.push('weapon_fire verisi yok: atış sayısı ve hareket halinde atış oranı hesaplanmadı.');
    }

    /* --- Silah bazında dağılım -------------------------------------- */
    const weaponMap = new Map();
    for (const kill of kills) {
      if (kill.suicide || kill.teamKill || !kill.actorSteamId) continue;
      const key = `${kill.actorSteamId}:${kill.weapon}`;
      if (!weaponMap.has(key)) {
        weaponMap.set(key, {
          steamId: String(kill.actorSteamId),
          key: kill.weapon,
          label: kill.weaponLabel || kill.weapon,
          kills: 0, headshots: 0, shots: 0, hits: 0, damage: 0, blindKills: 0
        });
      }
      const entry = weaponMap.get(key);
      entry.kills += 1;
      if (kill.headshot) entry.headshots += 1;
      if (kill.attackerBlind) entry.blindKills += 1;
    }
    for (const shot of shots) {
      if (shot.actorSteamId == null) continue;
      const key = `${shot.actorSteamId}:${shot.weapon}`;
      if (!weaponMap.has(key)) {
        weaponMap.set(key, {
          steamId: String(shot.actorSteamId),
          key: shot.weapon,
          label: shot.weaponLabel || shot.weapon,
          kills: 0, headshots: 0, shots: 0, hits: 0, damage: 0, blindKills: 0
        });
      }
      weaponMap.get(key).shots += 1;
    }
    /*
     * bullet_impact çoğu zaman silah adı taşımaz: her isabet, aynı oyuncunun
     * en yakın önceki atışına (±2 tick) bağlanır, böylece silah bazında isabet
     * sayısı da doğru çıkar.
     */
    for (const impact of impacts) {
      if (impact.actorSteamId == null) continue;
      const owner = String(impact.actorSteamId);
      if (impact.weapon) {
        const key = `${owner}:${impact.weapon}`;
        if (weaponMap.has(key)) {
          weaponMap.get(key).hits += 1;
          continue;
        }
      }
      const matched = matchShotForImpact(shotsByPlayer.get(owner) || [], impact.tick);
      if (!matched) continue;
      const key = `${owner}:${matched.weapon}`;
      if (weaponMap.has(key)) weaponMap.get(key).hits += 1;
    }
    for (const event of damage) {
      if (event.actorSteamId == null) continue;
      const key = `${event.actorSteamId}:${event.weapon}`;
      if (weaponMap.has(key)) weaponMap.get(key).damage += num(event.damage) || 0;
    }
    for (const entry of weaponMap.values()) {
      const row = rows.get(entry.steamId);
      if (!row) continue;
      row.weapons.push({
        ...entry,
        accuracy: impactsAvailable && entry.shots > 0 ? (entry.hits / entry.shots) * 100 : null
      });
    }
    for (const row of rows.values()) {
      row.weapons.sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    }

    /* --- Düellolar --------------------------------------------------- */
    const duels = [];
    const crosshairSamples = new Map();   // steamId -> [deg]
    const reactionSamples = new Map();    // steamId -> [ms]
    const distanceSamples = new Map();    // steamId -> [units]
    const movingShotFlags = new Map();    // steamId -> [bool]

    if (framesAvailable) {
      for (const shot of shots) {
        if (shot.actorSteamId == null) continue;
        const speed = speedAt(frames, String(shot.actorSteamId), shot.tick, tickRate);
        if (speed == null) continue;
        if (!movingShotFlags.has(String(shot.actorSteamId))) movingShotFlags.set(String(shot.actorSteamId), []);
        movingShotFlags.get(String(shot.actorSteamId)).push(speed > config.movingSpeedUnitsPerSecond);
      }
    } else {
      warnings.push('Tick state yok: crosshair açı hatası, hareket halinde atış ve reaction time hesaplanmadı.');
    }

    for (const kill of kills) {
      if (kill.suicide || kill.teamKill || !kill.actorSteamId || !kill.targetSteamId) continue;
      const attackerId = String(kill.actorSteamId);
      const victimId = String(kill.targetSteamId);
      const row = rows.get(attackerId);
      const windowStart = kill.tick - config.duelWindowSeconds * tickRate;

      const attackerShots = (shotsByPlayer.get(attackerId) || [])
        .filter((shot) => shot.tick >= windowStart && shot.tick <= kill.tick)
        .sort((a, b) => a.tick - b.tick);
      const pairDamage = damage
        .filter((event) => String(event.actorSteamId) === attackerId
          && String(event.targetSteamId) === victimId
          && event.tick >= windowStart && event.tick <= kill.tick)
        .sort((a, b) => a.tick - b.tick);

      const startTick = Math.min(
        attackerShots.length ? attackerShots[0].tick : kill.tick,
        pairDamage.length ? pairDamage[0].tick : kill.tick
      );

      // Mesafe: kill event konumları, yoksa frame'ler
      let distance = null;
      if (kill.attackerPosition && kill.position) {
        distance = distance3(kill.attackerPosition, kill.position);
      }
      if (distance == null && framesAvailable) {
        const frame = frameAtOrBefore(frames, kill.tick);
        const attackerState = stateOf(frame, attackerId);
        const victimState = stateOf(frame, victimId);
        distance = attackerState && victimState ? distance3(attackerState, victimState) : null;
      }
      if (distance != null && distance <= config.maxDuelDistance) {
        if (!distanceSamples.has(attackerId)) distanceSamples.set(attackerId, []);
        distanceSamples.get(attackerId).push(distance);
      }

      // Crosshair hatası: penceredeki ilk atış anı
      let crosshairError = null;
      let crosshairTick = null;
      if (framesAvailable) {
        crosshairTick = attackerShots.length ? attackerShots[0].tick : kill.tick;
        crosshairError = crosshairErrorAt(frames, attackerId, victimId, crosshairTick);
        if (crosshairError != null) {
          if (!crosshairSamples.has(attackerId)) crosshairSamples.set(attackerId, []);
          crosshairSamples.get(attackerId).push(crosshairError);
        }
      }

      /*
       * Potential reaction time: hedefin görüş konisine GİRDİĞİ an -> ilk atış.
       * Hedef pencerenin ilk frame'inde zaten koni içindeyse "giriş anı" bilinemez;
       * bu durumda tahmin üretilmez (null) ve clamped=true işaretlenir.
       */
      let visibleTick = null;
      let reactionMs = null;
      let clamped = false;
      let reactionReason = framesAvailable ? 'no-visible-tick' : 'no-frames';
      if (framesAvailable) {
        const roundStartTick = kill.roundIndex >= 0 ? (model.rounds?.[kill.roundIndex]?.startTick ?? null) : null;
        const searchFrom = Math.max(windowStart, roundStartTick == null ? 0 : roundStartTick);
        const entry = firstVisibleEntry(frames, attackerId, victimId, searchFrom, kill.tick, config);
        if (entry) {
          visibleTick = entry.tick;
          clamped = entry.clamped;
          if (!entry.clamped) {
            const firstShotAfter = attackerShots.find((shot) => shot.tick >= visibleTick);
            if (firstShotAfter) {
              reactionMs = ((firstShotAfter.tick - visibleTick) / tickRate) * 1000;
              reactionReason = 'ok';
              if (!reactionSamples.has(attackerId)) reactionSamples.set(attackerId, []);
              reactionSamples.get(attackerId).push(reactionMs);
            } else {
              reactionReason = 'no-shot-after-visible';
            }
          } else {
            reactionReason = 'target-already-visible';
          }
        }
      }

      if (kill.attackerBlind && row) row.blindKills += 1;

      duels.push({
        id: `${kill.tick}:${attackerId}:${victimId}`,
        tick: kill.tick,
        round: kill.round ?? null,
        roundIndex: kill.roundIndex,
        startTick,
        endTick: kill.tick,
        jumpTick: Math.max(0, (visibleTick ?? startTick) - Math.round(tickRate * 0.5)),
        reactionReason,
        attackerSteamId: attackerId,
        attackerName: kill.actorName || (rows.get(attackerId)?.name ?? ''),
        victimSteamId: victimId,
        victimName: kill.targetName || (rows.get(victimId)?.name ?? ''),
        weapon: kill.weapon,
        weaponLabel: kill.weaponLabel || kill.weapon,
        headshot: Boolean(kill.headshot),
        attackerBlind: Boolean(kill.attackerBlind),
        attackerInAir: Boolean(kill.attackerInAir),
        thruSmoke: Boolean(kill.thruSmoke),
        shotCount: attackerShots.length,
        hitCount: pairDamage.length,
        damage: pairDamage.reduce((sum, event) => sum + (num(event.damage) || 0), 0),
        distance,
        crosshairErrorDeg: crosshairError,
        crosshairTick,
        potentialReactionMs: reactionMs,
        visibleTick,
        clamped,
        killed: true
      });
    }

    duels.sort((a, b) => a.tick - b.tick);

    /* --- Oyuncu özetleri -------------------------------------------- */
    for (const row of rows.values()) {
      const key = String(row.steamId);
      const distances = distanceSamples.get(key) || [];
      row.avgKillDistance = distances.length
        ? distances.reduce((sum, value) => sum + value, 0) / distances.length
        : null;
      row.distanceSamples = distances.length;

      const moving = movingShotFlags.get(key) || [];
      row.movingShots = moving.length ? moving.filter(Boolean).length : null;
      row.movingShotRate = moving.length ? (moving.filter(Boolean).length / moving.length) * 100 : null;

      const errors = crosshairSamples.get(key) || [];
      row.crosshairErrorDeg = errors.length ? mean(errors) : null;
      row.crosshairSamples = errors.length;

      const reactions = reactionSamples.get(key) || [];
      row.potentialReactionMs = reactions.length ? mean(reactions) : null;
      row.reactionSamples = reactions.length;

      const confidenceFlags = [
        framesAvailable ? 0 : 1,
        impactsAvailable ? 0 : 1,
        shotsAvailable ? 0 : 1
      ].reduce((sum, value) => sum + value, 0);
      row.confidence = confidenceFlags === 0 ? 'high' : confidenceFlags === 1 ? 'medium' : 'low';
    }

    const playerRows = [...rows.values()].sort((a, b) => (b.kills - a.kills) || String(a.name).localeCompare(String(b.name)));

    /* --- Genel toplamlar -------------------------------------------- */
    const totals = emptyTotals();
    for (const row of playerRows) {
      totals.kills += row.kills;
      totals.headshots += row.headshots;
      totals.shots += row.shots;
      totals.impacts += row.impacts;
      totals.blindKills += row.blindKills;
      totals.damage += row.damage;
      if (row.crosshairErrorDeg != null) {
        totals.crosshairErrorSum += row.crosshairErrorDeg * row.crosshairSamples;
        totals.crosshairSamples += row.crosshairSamples;
      }
      if (row.potentialReactionMs != null) {
        totals.reactionSum += row.potentialReactionMs * row.reactionSamples;
        totals.reactionSamples += row.reactionSamples;
      }
      if (row.avgKillDistance != null) {
        totals.distanceSum += row.avgKillDistance * row.distanceSamples;
        totals.distanceSamples += row.distanceSamples;
      }
      if (row.movingShots != null) {
        totals.movingShots += row.movingShots;
        totals.movingShotSamples += (movingShotFlags.get(String(row.steamId)) || []).length;
      }
    }
    totals.accuracy = impactsAvailable && totals.shots > 0 ? (totals.impacts / totals.shots) * 100 : null;
    totals.headshotPercent = totals.kills > 0 ? (totals.headshots / totals.kills) * 100 : null;
    totals.crosshairErrorDeg = totals.crosshairSamples > 0 ? totals.crosshairErrorSum / totals.crosshairSamples : null;
    totals.potentialReactionMs = totals.reactionSamples > 0 ? totals.reactionSum / totals.reactionSamples : null;
    totals.avgKillDistance = totals.distanceSamples > 0 ? totals.distanceSum / totals.distanceSamples : null;
    totals.movingShotRate = totals.movingShotSamples > 0 ? (totals.movingShots / totals.movingShotSamples) * 100 : null;

    return {
      schemaVersion: SCHEMA_VERSION,
      available: true,
      reason: null,
      availability: {
        frames: framesAvailable ? 'full' : 'unavailable',
        shots: shotsAvailable ? 'full' : 'unavailable',
        impacts: impactsAvailable ? 'full' : 'unavailable',
        damage: damageAvailable ? 'full' : 'unavailable',
        kills: killsAvailable ? 'full' : 'unavailable'
      },
      warnings,
      map: model.match?.map || null,
      tickRate,
      roundCount: (model.rounds || []).length,
      thresholds: config,
      players: playerRows,
      duels,
      totals
    };

    /* --- iç yardımcılar --------------------------------------------- */
    function crosshairErrorAt(frameList, attackerId, victimId, tick) {
      const frame = frameAtOrBefore(frameList, tick);
      if (!frame) return null;
      const attacker = stateOf(frame, attackerId);
      const victim = stateOf(frame, victimId);
      if (!attacker || !victim) return null;
      return crosshairErrorDeg(attacker, victim);
    }

    function firstVisibleEntry(frameList, attackerId, victimId, fromTick, toTick, settings) {
      let firstChecked = null;
      for (const frame of frameList) {
        const tick = num(frame?.tick);
        if (tick == null || tick < fromTick || tick > toTick) continue;
        if (firstChecked == null) firstChecked = tick;
        const attacker = stateOf(frame, attackerId);
        const victim = stateOf(frame, victimId);
        if (!attacker || !victim || !victim.isAlive) continue;
        const distance = distance3(attacker, victim);
        if (distance == null || distance > settings.maxDuelDistance) continue;
        if (isInViewCone(attacker, victim, settings.fovHalfDegrees)) {
          return { tick, clamped: tick === firstChecked };
        }
      }
      return null;
    }
  }

  function speedAt(frames, steamId, tick, tickRate) {
    const current = frameAtOrBefore(frames, tick);
    if (!current) return null;
    const previous = previousFrame(frames, current);
    const state = stateOf(current, steamId);
    if (!state) return null;
    if (previous) {
      const previousState = stateOf(previous, steamId);
      const speed = speedUnitsPerSecond(previousState, state, tickRate);
      if (speed != null) return speed;
    }
    const next = frameAtOrAfter(frames, tick + 1);
    const nextState = next ? stateOf(next, steamId) : null;
    return nextState ? speedUnitsPerSecond(state, nextState, tickRate) : null;
  }

  function previousFrame(frames, frame) {
    const index = frames.indexOf(frame);
    return index > 0 ? frames[index - 1] : null;
  }

  /* Isabeti kendisinden önceki en yakın atışa bağlar (aynı tick veya 1-2 tick önce). */
  function matchShotForImpact(shotList, tick, toleranceTicks = 2) {
    let best = null;
    for (const shot of shotList) {
      const delta = tick - shot.tick;
      if (delta < 0 || delta > toleranceTicks) continue;
      if (!best || shot.tick > best.tick) best = shot;
    }
    return best;
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function emptyTotals() {
    return {
      kills: 0, headshots: 0, headshotPercent: null, damage: 0,
      shots: 0, impacts: 0, accuracy: null,
      avgKillDistance: null, distanceSum: 0, distanceSamples: 0,
      crosshairErrorDeg: null, crosshairErrorSum: 0, crosshairSamples: 0,
      potentialReactionMs: null, reactionSum: 0, reactionSamples: 0,
      movingShots: 0, movingShotRate: null, movingShotSamples: 0,
      blindKills: 0
    };
  }

  return {
    SCHEMA_VERSION,
    DEFAULTS,
    buildAimModel,
    distance3,
    forwardVector,
    angleBetweenDeg,
    directionBetween,
    crosshairErrorDeg,
    isInViewCone,
    speedUnitsPerSecond,
    frameAtOrBefore,
    frameAtOrAfter,
    stateOf,
    matchShotForImpact
  };
}));
