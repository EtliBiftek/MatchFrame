(() => {
  let damageBySteam = new Map();

  function buildDamageIndex(result) {
    damageBySteam = new Map();
    const frames = result?.frames || [];
    const previous = new Map();
    for (const frame of frames) {
      const tick = Number(frame?.tick || 0);
      for (const player of frame?.players || []) {
        const steamid = String(player?.steamid || '');
        if (!steamid) continue;
        const hp = Number(player?.health);
        const before = previous.get(steamid);
        if (Number.isFinite(hp) && before && Number.isFinite(before.hp) && hp < before.hp && hp >= 0) {
          if (!damageBySteam.has(steamid)) damageBySteam.set(steamid, []);
          damageBySteam.get(steamid).push({ tick, amount: Math.max(1, before.hp - hp) });
        }
        if (Number.isFinite(hp)) previous.set(steamid, { tick, hp });
      }
    }
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

  function drawDamageEffects(frame) {
    if (viewMode !== 'tactical' || !frame || !window.matchframeRadarFast) return;
    const life = tickRate() * .48;
    for (const player of frame.players || []) {
      if (!player?.is_alive || !Number.isFinite(player.X) || !Number.isFinite(player.Y)) continue;
      const steamid = String(player.steamid || '');
      const hit = latestEvent(damageBySteam.get(steamid), currentTick);
      if (!hit) continue;
      const elapsed = currentTick - hit.tick;
      if (elapsed < 0 || elapsed > life) continue;
      const point = window.matchframeRadarFast.worldToScreen(player.X, player.Y);
      if (!point) continue;
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

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    buildDamageIndex(result);
    previousLoadDemo(result);
  };

  const previousDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    previousDraw();
    if (viewMode !== 'tactical') return;
    drawDamageEffects(nearestFrame(currentTick));
  };
})();
