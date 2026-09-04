(() => {
  let damageBySteam = new Map();
  let fireBySteam = new Map();
  let utilityOwners = { smokes: [], infernos: [], hes: [], flashes: [] };

  function pushEvent(index, steamid, event) {
    if (!steamid) return;
    if (!index.has(steamid)) index.set(steamid, []);
    index.get(steamid).push(event);
  }

  function eventTick(event) {
    const tick = Number(event?.tick || 0);
    return Number.isFinite(tick) ? tick : 0;
  }

  function eventName(event) {
    return String(event?.user_name ?? event?.player_name ?? event?.thrower_name ?? event?.name ?? '').trim();
  }

  function eventPosition(event) {
    const X = Number(event?.x ?? event?.X ?? event?.user_X ?? event?.player_X);
    const Y = Number(event?.y ?? event?.Y ?? event?.user_Y ?? event?.player_Y);
    const Z = Number(event?.z ?? event?.Z ?? event?.user_Z ?? event?.player_Z ?? 0);
    return [X, Y, Z].every(Number.isFinite) ? { X, Y, Z } : null;
  }

  function entityId(event) {
    return String(event?.entityid ?? event?.entity_id ?? event?.grenade_entity_id ?? '');
  }

  function pairLifecycle(starts, ends, fallbackSeconds) {
    const endBuckets = new Map();
    for (const event of ends || []) {
      const id = entityId(event);
      if (!id) continue;
      if (!endBuckets.has(id)) endBuckets.set(id, []);
      endBuckets.get(id).push(event);
    }
    for (const list of endBuckets.values()) list.sort((a, b) => eventTick(a) - eventTick(b));
    return (starts || []).map((start) => {
      const startTick = eventTick(start);
      const id = entityId(start);
      const end = (endBuckets.get(id) || []).find((candidate) => eventTick(candidate) > startTick);
      return {
        tick: startTick,
        endTick: end ? eventTick(end) : startTick + 64 * fallbackSeconds,
        name: eventName(start),
        position: eventPosition(start)
      };
    }).filter((item) => item.position);
  }

  function buildCombatIndex(result) {
    damageBySteam = new Map();
    fireBySteam = new Map();
    const frames = result?.frames || [];
    const previous = new Map();
    for (const frame of frames) {
      const tick = Number(frame?.tick || 0);
      for (const player of frame?.players || []) {
        const steamid = String(player?.steamid || '');
        if (!steamid) continue;
        const hp = Number(player?.health);
        const ammo = Number(player?.active_weapon_ammo);
        const weapon = String(player?.active_weapon_name || '').toLowerCase();
        const before = previous.get(steamid);

        if (Number.isFinite(hp) && before && Number.isFinite(before.hp) && hp < before.hp && hp >= 0) {
          pushEvent(damageBySteam, steamid, { tick, amount: Math.max(1, before.hp - hp) });
        }

        if (before && weapon && before.weapon === weapon && Number.isFinite(ammo) && Number.isFinite(before.ammo) && ammo < before.ammo && before.ammo > 0) {
          pushEvent(fireBySteam, steamid, { tick, shots: Math.max(1, before.ammo - ammo), weapon });
        }

        previous.set(steamid, {
          tick,
          hp: Number.isFinite(hp) ? hp : before?.hp,
          ammo: Number.isFinite(ammo) ? ammo : null,
          weapon
        });
      }
    }

    const utility = result?.utility || {};
    utilityOwners = {
      smokes: pairLifecycle(utility.smokeStarts, utility.smokeEnds, 18),
      infernos: pairLifecycle(utility.infernoStarts, utility.infernoEnds, 7),
      hes: (utility.heDetonates || []).map((event) => ({ tick: eventTick(event), endTick: eventTick(event) + 64 * .8, name: eventName(event), position: eventPosition(event) })).filter((x) => x.position),
      flashes: (utility.flashDetonates || []).map((event) => ({ tick: eventTick(event), endTick: eventTick(event) + 64 * 1.1, name: eventName(event), position: eventPosition(event) })).filter((x) => x.position)
    };
  }

  function latestEvent(events, tick) {
    if (!events?.length) return null;
    let lo = 0, hi = events.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (events[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return events[lo]?.tick <= tick ? events[lo] : null;
  }

  function playerPoint(player) {
    if (!player?.is_alive || !Number.isFinite(player.X) || !Number.isFinite(player.Y)) return null;
    return window.matchframeRadarFast?.worldToScreen?.(player.X, player.Y) || null;
  }

  function drawDamageEffects(frame) {
    if (viewMode !== 'tactical' || !frame || !window.matchframeRadarFast) return;
    const life = tickRate() * .48;
    for (const player of frame.players || []) {
      const point = playerPoint(player);
      if (!point) continue;
      const hit = latestEvent(damageBySteam.get(String(player.steamid || '')), currentTick);
      if (!hit) continue;
      const elapsed = currentTick - hit.tick;
      if (elapsed < 0 || elapsed > life) continue;
      const [x, y] = point;
      const t = Math.max(0, Math.min(1, elapsed / life));
      const pulse = .5 + .5 * Math.sin(performance.now() / 45);
      ctx.save();
      ctx.globalAlpha = (1 - t) * (.58 + pulse * .3);
      ctx.shadowBlur = 14;
      ctx.shadowColor = 'rgba(255,45,45,.95)';
      ctx.fillStyle = 'rgba(255,48,48,.46)';
      ctx.strokeStyle = 'rgba(255,82,82,.98)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, y, 10 + pulse * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFireEffects(frame) {
    if (viewMode !== 'tactical' || !frame || !window.matchframeRadarFast) return;
    const life = tickRate() * .22;
    for (const player of frame.players || []) {
      const point = playerPoint(player);
      if (!point) continue;
      const shot = latestEvent(fireBySteam.get(String(player.steamid || '')), currentTick);
      if (!shot) continue;
      const elapsed = currentTick - shot.tick;
      if (elapsed < 0 || elapsed > life) continue;
      const [x, y] = point;
      const t = Math.max(0, Math.min(1, elapsed / life));
      const pulse = .5 + .5 * Math.sin(performance.now() / 28);
      ctx.save();
      ctx.globalAlpha = (1 - t) * (.72 + pulse * .26);
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(255,255,255,.98)';
      ctx.strokeStyle = 'rgba(255,255,255,.98)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, 11 + pulse * 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawOwnerTag(item) {
    if (!item?.name || currentTick < item.tick || currentTick > item.endTick) return;
    const point = window.matchframeRadarFast?.worldToScreen?.(item.position.X, item.position.Y);
    if (!point) return;
    const [x, y] = point;
    ctx.save();
    ctx.font = '600 8px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = item.name;
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(8,8,10,.82)';
    ctx.fillRect(x - width / 2, y + 10, width, 13);
    ctx.fillStyle = 'rgba(247,247,249,.96)';
    ctx.fillText(text, x, y + 16.5);
    ctx.restore();
  }

  function drawUtilityOwners() {
    if (viewMode !== 'tactical' || !window.matchframeRadarFast) return;
    for (const item of utilityOwners.smokes) drawOwnerTag(item);
    for (const item of utilityOwners.infernos) drawOwnerTag(item);
    for (const item of utilityOwners.hes) drawOwnerTag(item);
    for (const item of utilityOwners.flashes) drawOwnerTag(item);
  }

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    buildCombatIndex(result);
    previousLoadDemo(result);
  };

  const previousDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    previousDraw();
    if (viewMode !== 'tactical') return;
    const frame = nearestFrame(currentTick);
    drawDamageEffects(frame);
    drawFireEffects(frame);
    drawUtilityOwners();
  };
})();
