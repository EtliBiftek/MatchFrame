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

  const previousDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    previousDraw();
    drawPlantedC4();
  };
})();
