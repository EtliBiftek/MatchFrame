(() => {
  let bombIndex = { plants: [], defuses: [], explosions: [], drops: [], pickups: [] };

  function tickOf(event) {
    const value = Number(event?.tick || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function eventPosition(event) {
    const X = Number(event?.user_X ?? event?.player_X ?? event?.X ?? event?.x);
    const Y = Number(event?.user_Y ?? event?.player_Y ?? event?.Y ?? event?.y);
    const Z = Number(event?.user_Z ?? event?.player_Z ?? event?.Z ?? event?.z ?? 0);
    return [X, Y, Z].every(Number.isFinite) ? { X, Y, Z } : null;
  }

  function buildBombIndex(result) {
    const bomb = result?.bomb || {};
    bombIndex = {
      plants: (bomb.plants || result?.plants || []).map((event) => ({ event, tick: tickOf(event), position: eventPosition(event) })).filter((x) => x.position),
      defuses: (bomb.defuses || result?.defuses || []).map((event) => ({ event, tick: tickOf(event) })),
      explosions: (bomb.explosions || result?.explosions || []).map((event) => ({ event, tick: tickOf(event) })),
      drops: (bomb.drops || []).map((event) => ({ event, tick: tickOf(event), position: eventPosition(event) })).filter((x) => x.position),
      pickups: (bomb.pickups || []).map((event) => ({ event, tick: tickOf(event) }))
    };
  }

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    buildBombIndex(result);
    previousLoadDemo(result);
  };

  function plantEndTick(plant, index) {
    const nextPlant = bombIndex.plants[index + 1]?.tick ?? Infinity;
    const defuse = bombIndex.defuses.find((item) => item.tick >= plant.tick && item.tick < nextPlant)?.tick ?? Infinity;
    const explosion = bombIndex.explosions.find((item) => item.tick >= plant.tick && item.tick < nextPlant)?.tick ?? Infinity;
    return Math.min(nextPlant, defuse, explosion);
  }

  function dropEndTick(drop) {
    const pickup = bombIndex.pickups.find((item) => item.tick > drop.tick)?.tick ?? Infinity;
    const plant = bombIndex.plants.find((item) => item.tick > drop.tick)?.tick ?? Infinity;
    const nextDrop = bombIndex.drops.find((item) => item.tick > drop.tick)?.tick ?? Infinity;
    return Math.min(pickup, plant, nextDrop);
  }

  function worldRadiusToPixels(radius) {
    const viewport = window.matchframeRadarFast?.viewport?.();
    const asset = typeof mfRadarAsset !== 'undefined' ? mfRadarAsset : null;
    const image = typeof mfRadarImage !== 'undefined' ? mfRadarImage : null;
    if (!viewport || !asset?.overview || !image) return 0;
    const imageW = Math.max(1, image.naturalWidth || image.width || 1);
    return Math.abs(Number(radius) / Number(asset.overview.scale || 1) / imageW * viewport.w);
  }

  function drawC4Symbol(x, y, pulse = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(18,18,20,.9)';
    ctx.strokeStyle = 'rgba(247,95,78,.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-8, -6, 16, 12, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(247,95,78,.95)';
    ctx.fillRect(-3, -2, 6, 4);
    ctx.globalAlpha = .35 * pulse;
    ctx.beginPath();
    ctx.arc(0, 0, 13 + pulse * 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(247,95,78,.8)';
    ctx.stroke();
    ctx.restore();
  }

  function drawC4Carrier() {
    if (viewMode !== 'tactical' || !demo || !window.matchframeRadarFast) return;
    const frame = nearestFrame(currentTick);
    if (!frame) return;
    const pulse = .5 + .5 * Math.sin(performance.now() / 130);
    for (const player of frame.players || []) {
      if (!player.has_c4 || !player.is_alive || !Number.isFinite(player.X) || !Number.isFinite(player.Y)) continue;
      const point = window.matchframeRadarFast.worldToScreen(player.X, player.Y);
      if (!point) continue;
      const [x, y] = point;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(247,95,78,.18)';
      ctx.strokeStyle = 'rgba(255,128,108,.98)';
      ctx.lineWidth = 2;
      const size = 9 + pulse * 1.5;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
      ctx.save();
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,190,178,.98)';
      ctx.fillText('C4', x, y - 15);
      ctx.restore();
    }
  }

  function drawDroppedC4() {
    if (viewMode !== 'tactical' || !demo || !window.matchframeRadarFast) return;
    const pulse = .5 + .5 * Math.sin(performance.now() / 170);
    for (const drop of bombIndex.drops) {
      const end = dropEndTick(drop);
      if (currentTick < drop.tick || currentTick >= end) continue;
      const point = window.matchframeRadarFast.worldToScreen(drop.position.X, drop.position.Y);
      if (!point) continue;
      const [x, y] = point;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(255,118,96,.22)';
      ctx.strokeStyle = 'rgba(255,139,119,.95)';
      ctx.lineWidth = 1.5;
      const size = 7 + pulse;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
      ctx.save();
      ctx.font = '8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,191,180,.96)';
      ctx.fillText('C4 YERDE', x, y - 14);
      ctx.restore();
    }
  }

  function drawPlantedC4() {
    if (viewMode !== 'tactical' || !demo || !window.matchframeRadarFast) return;
    const viewport = window.matchframeRadarFast.viewport();
    if (!viewport) return;
    for (let i = 0; i < bombIndex.plants.length; i++) {
      const plant = bombIndex.plants[i];
      const end = plantEndTick(plant, i);
      if (currentTick < plant.tick || currentTick >= end) continue;
      const point = window.matchframeRadarFast.worldToScreen(plant.position.X, plant.position.Y);
      if (!point) continue;
      const [x, y] = point;
      const pulse = .5 + .5 * Math.sin(performance.now() / 115);
      drawC4Symbol(x, y, pulse);
      const seconds = Math.max(0, (end - currentTick) / tickRate());
      ctx.save();
      ctx.font = '8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,218,211,.95)';
      ctx.fillText(`C4 ${seconds.toFixed(seconds < 10 ? 1 : 0)}s`, x, y - 17);
      ctx.restore();
    }
  }

  function explosionPlant(explosion) {
    let found = null;
    for (const plant of bombIndex.plants) {
      if (plant.tick <= explosion.tick) found = plant;
      else break;
    }
    return found;
  }

  function drawBombExplosions() {
    if (viewMode !== 'tactical' || !demo || !window.matchframeRadarFast) return;
    const life = tickRate() * 1.35;
    for (const explosion of bombIndex.explosions) {
      const elapsed = currentTick - explosion.tick;
      if (elapsed < 0 || elapsed > life) continue;
      const plant = explosionPlant(explosion);
      if (!plant?.position) continue;
      const point = window.matchframeRadarFast.worldToScreen(plant.position.X, plant.position.Y);
      if (!point) continue;
      const [x, y] = point;
      const t = Math.max(0, Math.min(1, elapsed / life));
      const ease = 1 - Math.pow(1 - t, 3);
      const maxRadius = worldRadiusToPixels(1750);
      const radius = maxRadius * ease;
      ctx.save();
      const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
      grad.addColorStop(0, `rgba(255,103,70,${.28 * (1 - t)})`);
      grad.addColorStop(.42, `rgba(245,84,58,${.15 * (1 - t)})`);
      grad.addColorStop(1, 'rgba(245,84,58,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = 'rgba(255,119,91,.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255,185,165,.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius * .55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,196,181,${Math.max(0, 1 - t)})`;
      ctx.fillText('C4 PATLAMA ALANI', x, y - Math.min(radius + 8, 58));
      ctx.restore();
    }
  }

  const previousDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    previousDraw();
    drawC4Carrier();
    drawDroppedC4();
    drawPlantedC4();
    drawBombExplosions();
  };
})();
