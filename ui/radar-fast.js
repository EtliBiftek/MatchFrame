(() => {
  let backgroundCanvas = null;
  let backgroundKey = '';
  let cachedViewport = null;

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

  window.matchframeRadarFast = { worldToScreen: (x, y) => cachedViewport ? worldToScreen(x, y, cachedViewport) : null, viewport: () => cachedViewport };
})();
