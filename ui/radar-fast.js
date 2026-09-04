(() => {
  let backgroundCanvas = null;
  let backgroundKey = '';
  let cachedViewport = null;
  let utilityIndex = { smokes: [], infernos: [], hes: [], flashes: [], blinds: [] };

  const baseResizeCanvas = resizeCanvas;
  resizeCanvas = function() {
    if (viewMode !== 'tactical') return baseResizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      backgroundKey = '';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  };

  function viewportFor(width, height) {
    const image = mfRadarImage;
    const margin = 16;
    const maxW = Math.max(1, width - margin * 2);
    const maxH = Math.max(1, height - margin * 2);
    const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }

  function worldToScreen(worldX, worldY, viewport) {
    const overview = mfRadarAsset.overview;
    const radarX = (Number(worldX) - overview.posX) / overview.scale;
    const radarY = (overview.posY - Number(worldY)) / overview.scale;
    const imageW = Math.max(1, mfRadarImage.naturalWidth);
    const imageH = Math.max(1, mfRadarImage.naturalHeight);
    return [viewport.x + (radarX / imageW) * viewport.w, viewport.y + (radarY / imageH) * viewport.h];
  }

  function worldRadiusToPixels(radius, viewport) {
    const imageW = Math.max(1, mfRadarImage.naturalWidth);
    return Math.abs(Number(radius) / Number(mfRadarAsset.overview.scale || 1) / imageW * viewport.w);
  }

  function ensureBackground(width, height) {
    const key = `${Math.round(width)}x${Math.round(height)}:${mfRadarAsset?.map || ''}`;
    if (backgroundCanvas && backgroundKey === key && cachedViewport) return cachedViewport;
    const bg = document.createElement('canvas');
    bg.width = Math.max(1, Math.round(width));
    bg.height = Math.max(1, Math.round(height));
    const bctx = bg.getContext('2d', { alpha: false });
    const viewport = viewportFor(width, height);
    bctx.fillStyle = '#09090b';
    bctx.fillRect(0, 0, width, height);
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.globalAlpha = .9;
    bctx.drawImage(mfRadarImage, viewport.x, viewport.y, viewport.w, viewport.h);
    bctx.globalAlpha = 1;
    bctx.strokeStyle = 'rgba(255,255,255,.08)';
    bctx.lineWidth = 1;
    bctx.strokeRect(viewport.x + .5, viewport.y + .5, viewport.w - 1, viewport.h - 1);
    backgroundCanvas = bg;
    backgroundKey = key;
    cachedViewport = viewport;
    return viewport;
  }

  function eventTick(event) {
    const value = Number(event?.tick || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function entityId(event) {
    return String(event?.entityid ?? event?.entity_id ?? event?.grenade_entity_id ?? '');
  }

  function eventPosition(event) {
    const X = Number(event?.x ?? event?.X ?? event?.user_X ?? event?.player_X);
    const Y = Number(event?.y ?? event?.Y ?? event?.user_Y ?? event?.player_Y);
    const Z = Number(event?.z ?? event?.Z ?? event?.user_Z ?? event?.player_Z ?? 0);
    return [X, Y, Z].every(Number.isFinite) ? { X, Y, Z } : null;
  }

  function pairLifecycle(starts, ends) {
    const endBuckets = new Map();
    for (const event of ends || []) {
      const id = entityId(event);
      if (!id) continue;
      if (!endBuckets.has(id)) endBuckets.set(id, []);
      endBuckets.get(id).push(event);
    }
    for (const list of endBuckets.values()) list.sort((a, b) => eventTick(a) - eventTick(b));
    return (starts || []).map((start) => {
      const id = entityId(start);
      const startTick = eventTick(start);
      const end = (endBuckets.get(id) || []).find((candidate) => eventTick(candidate) > startTick) || null;
      return { start, startTick, endTick: end ? eventTick(end) : null, position: eventPosition(start) };
    }).filter((item) => item.position && item.startTick >= 0);
  }

  function buildUtilityIndex(result) {
    const utility = result?.utility || {};
    utilityIndex = {
      smokes: pairLifecycle(utility.smokeStarts, utility.smokeEnds),
      infernos: pairLifecycle(utility.infernoStarts, utility.infernoEnds),
      hes: (utility.heDetonates || []).map((event) => ({ event, tick: eventTick(event), position: eventPosition(event) })).filter((item) => item.position),
      flashes: (utility.flashDetonates || []).map((event) => ({ event, tick: eventTick(event), position: eventPosition(event) })).filter((item) => item.position),
      blinds: (utility.playerBlinds || []).map((event) => ({ event, tick: eventTick(event) }))
    };
  }

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    buildUtilityIndex(result);
    backgroundKey = '';
    previousLoadDemo(result);
  };

  function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function remainingText(endTick) {
    const seconds = Math.max(0, (endTick - currentTick) / tickRate());
    return `${seconds.toFixed(seconds < 3 ? 1 : 0)}s`;
  }

  function drawUtilityLabel(x, y, text, remaining) {
    ctx.save();
    ctx.font = '8px Consolas, monospace';
    const value = remaining ? `${text} ${remaining}` : text;
    const width = ctx.measureText(value).width + 8;
    ctx.fillStyle = 'rgba(9,9,11,.78)';
    ctx.fillRect(x - width / 2, y - 5, width, 13);
    ctx.fillStyle = 'rgba(242,242,244,.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y + 1);
    ctx.restore();
  }

  function drawSmoke(item, viewport) {
    const start = item.startTick;
    const end = item.endTick ?? (start + tickRate() * 18);
    if (currentTick < start || currentTick > end) return;
    const age = (currentTick - start) / tickRate();
    const left = (end - currentTick) / tickRate();
    const grow = smoothstep(0, .75, age);
    const fade = smoothstep(0, .65, left);
    const [x, y] = worldToScreen(item.position.X, item.position.Y, viewport);
    const radius = worldRadiusToPixels(144, viewport) * grow;
    if (radius < 1) return;
    ctx.save();
    ctx.globalAlpha = .92 * fade;
    ctx.fillStyle = 'rgba(174,180,186,.22)';
    ctx.strokeStyle = 'rgba(218,222,226,.5)';
    ctx.lineWidth = 1;
    const phase = (currentTick - start) / Math.max(1, tickRate());
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + phase * .18;
      const rr = radius * (.22 + (i % 3) * .025);
      const dist = radius * .43;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, radius * .62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    drawUtilityLabel(x, y - radius - 8, 'SMOKE', remainingText(end));
  }

  function drawInferno(item, viewport) {
    const start = item.startTick;
    const end = item.endTick ?? (start + tickRate() * 7);
    if (currentTick < start || currentTick > end) return;
    const age = (currentTick - start) / tickRate();
    const left = (end - currentTick) / tickRate();
    const grow = smoothstep(0, .45, age);
    const fade = smoothstep(0, .45, left);
    const [x, y] = worldToScreen(item.position.X, item.position.Y, viewport);
    const radius = worldRadiusToPixels(180, viewport) * grow;
    if (radius < 1) return;
    ctx.save();
    ctx.globalAlpha = .9 * fade;
    const phase = (currentTick - start) / Math.max(1, tickRate());
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + Math.sin(i * 2.13) * .25;
      const dist = radius * (.18 + (i % 4) * .12);
      const rr = radius * (.16 + (i % 3) * .035) * (1 + Math.sin(phase * 6 + i) * .07);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, rr, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(222,113,55,.32)' : 'rgba(244,169,70,.28)';
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, radius * .86, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(245,173,82,.62)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    drawUtilityLabel(x, y - radius - 8, 'FIRE', remainingText(end));
  }

  function drawHe(item, viewport) {
    const life = tickRate() * .65;
    const elapsed = currentTick - item.tick;
    if (elapsed < 0 || elapsed > life) return;
    const t = elapsed / life;
    const [x, y] = worldToScreen(item.position.X, item.position.Y, viewport);
    const radius = worldRadiusToPixels(350, viewport) * (1 - Math.pow(1 - t, 3));
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(224,207,160,.85)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, radius * .32), 0, Math.PI * 2); ctx.fillStyle = 'rgba(224,207,160,.14)'; ctx.fill();
    ctx.restore();
    drawUtilityLabel(x, y - radius - 7, 'HE', '350u');
  }

  function drawFlash(item, viewport) {
    const life = tickRate() * 1.0;
    const elapsed = currentTick - item.tick;
    if (elapsed < 0 || elapsed > life) return;
    const t = elapsed / life;
    const [x, y] = worldToScreen(item.position.X, item.position.Y, viewport);
    const radius = worldRadiusToPixels(1200, viewport) * smoothstep(0, .45, t);
    ctx.save();
    ctx.globalAlpha = (1 - t) * .58;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(238,238,222,.72)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(x, y, radius * .55, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(238,238,222,.38)'; ctx.stroke();
    ctx.restore();
    drawUtilityLabel(x, y - Math.min(radius, 48) - 7, 'FLASH', 'LOS');
  }

  function blindPlayerSteam(event) {
    return String(event?.user_steamid ?? event?.player_steamid ?? event?.steamid ?? '');
  }

  function drawBlindEffects(frame, viewport) {
    for (const item of utilityIndex.blinds) {
      const duration = Math.max(.1, Number(item.event?.blind_duration ?? item.event?.user_blind_duration ?? 1));
      const end = item.tick + duration * tickRate();
      if (currentTick < item.tick || currentTick > end) continue;
      const steamid = blindPlayerSteam(item.event);
      if (!steamid) continue;
      const player = frame.players.find((state) => String(state.steamid || '') === steamid);
      if (!player || !Number.isFinite(player.X) || !Number.isFinite(player.Y)) continue;
      const [x, y] = worldToScreen(player.X, player.Y, viewport);
      const left = (end - currentTick) / Math.max(1, end - item.tick);
      ctx.save();
      ctx.globalAlpha = .2 + .45 * left;
      ctx.beginPath(); ctx.arc(x, y, 13 + Math.sin(currentTick / tickRate() * 8) * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(242,242,230,.22)'; ctx.fill();
      ctx.strokeStyle = 'rgba(250,250,235,.78)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();
    }
  }

  function drawUtilities(frame, viewport) {
    for (const smoke of utilityIndex.smokes) drawSmoke(smoke, viewport);
    for (const inferno of utilityIndex.infernos) drawInferno(inferno, viewport);
    for (const he of utilityIndex.hes) drawHe(he, viewport);
    for (const flash of utilityIndex.flashes) drawFlash(flash, viewport);
    drawBlindEffects(frame, viewport);
  }

  function drawMarker(player, selected, viewport, width) {
    if (!Number.isFinite(player.X) || !Number.isFinite(player.Y)) return;
    const [x, y] = worldToScreen(player.X, player.Y, viewport);
    if (x < viewport.x - 12 || x > viewport.x + viewport.w + 12 || y < viewport.y - 12 || y > viewport.y + viewport.h + 12) return;
    const isSelected = selected && String(player.steamid) === String(selected.steamid);
    const alive = player.is_alive && player.health > 0;
    const color = Number(player.team_num) === 2 ? '#d2ad69' : Number(player.team_num) === 3 ? '#79a7c7' : '#9a9aa2';
    ctx.save();
    ctx.globalAlpha = alive ? 1 : .3;
    if (isSelected) {
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,10,12,.72)'; ctx.fill();
      ctx.strokeStyle = '#f4f4f5'; ctx.lineWidth = 1.7; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, isSelected ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();

    const rad = -Number(player.yaw || 0) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(rad) * 14, y + Math.sin(rad) * 14);
    ctx.strokeStyle = isSelected ? '#f4f4f5' : color; ctx.lineWidth = 1.6; ctx.stroke();

    if (isSelected || width > 760) {
      ctx.font = '10px "Segoe UI", sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)';
      ctx.strokeText(player.name || 'Player', x + 9, y - 8);
      ctx.fillStyle = isSelected ? '#fff' : '#d3d3d8';
      ctx.fillText(player.name || 'Player', x + 9, y - 8);
    }
    ctx.restore();
  }

  const fallbackDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    if (viewMode !== 'tactical') return;
    if (!mfRadarAsset || !mfRadarImage) return fallbackDraw();
    const { width, height } = resizeCanvas();
    const viewport = ensureBackground(width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backgroundCanvas, 0, 0, width, height);

    const frame = nearestFrame(currentTick);
    if (!frame) return;
    drawUtilities(frame, viewport);

    const selected = playerInFrame(frame, selectedPlayer);
    if (selected && Number.isFinite(selected.X) && Number.isFinite(selected.Y)) {
      const [px, py] = worldToScreen(selected.X, selected.Y, viewport);
      drawVision(px, py, Number(selected.yaw || 0), Math.min(viewport.w, viewport.h) * .19);
    }
    for (const player of frame.players) drawMarker(player, selected, viewport, width);

    updateSelectedHud(frame);
    ctx.font = '9px Consolas, monospace';
    ctx.fillStyle = 'rgba(240,240,242,.48)';
    ctx.fillText(`VALVE RADAR · ${mfRadarAsset.map.toUpperCase()} · ${formatTick(frame.tick)}`, viewport.x + 10, viewport.y + viewport.h - 10);
  };

  window.matchframeRadarFast = {
    worldToScreen: (x, y) => cachedViewport ? worldToScreen(x, y, cachedViewport) : null,
    viewport: () => cachedViewport
  };
})();
