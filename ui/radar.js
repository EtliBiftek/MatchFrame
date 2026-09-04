var mfRadarAsset = null;
var mfRadarImage = null;
var mfRadarLoadingFor = null;

const mfOriginalLoadDemo = loadDemo;
const mfOriginalDrawCurrentFrame = drawCurrentFrame;

loadDemo = function(result) {
  mfRadarAsset = null;
  mfRadarImage = null;
  mfRadarLoadingFor = null;
  const grid = document.querySelector('.viewport-grid');
  if (grid) grid.style.opacity = '';
  mfOriginalLoadDemo(result);
  const map = String(result?.header?.map_name || '').toLowerCase();
  if (map) mfLoadRadar(map);
};

async function mfLoadRadar(map) {
  if (!window.matchframe?.radar?.load || mfRadarLoadingFor === map) return;
  mfRadarLoadingFor = map;
  const frameCount = demo?.frames?.length || 0;
  $('viewerLabel').textContent = `${map} radarı yükleniyor…`;
  try {
    const asset = await window.matchframe.radar.load(map);
    if (!asset?.dataUrl || !asset?.overview) throw new Error('Radar verisi eksik.');
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Radar PNG açılamadı.'));
      image.src = asset.dataUrl;
    });
    if (mfRadarLoadingFor !== map) return;
    mfRadarAsset = asset;
    mfRadarImage = image;
    const grid = document.querySelector('.viewport-grid');
    if (grid) grid.style.opacity = '.04';
    $('viewerLabel').textContent = `${frameCount.toLocaleString('tr-TR')} replay frame · ${map} radar`;
    log(`Radar loaded ${map}: pos_x ${asset.overview.posX}, pos_y ${asset.overview.posY}, scale ${asset.overview.scale}`, 'ok');
    drawCurrentFrame();
  } catch (error) {
    mfRadarAsset = null;
    mfRadarImage = null;
    $('viewerLabel').textContent = `${frameCount.toLocaleString('tr-TR')} replay frame · radar fallback`;
    log(`Radar load failed (${map}): ${error.message}`, 'error');
    drawCurrentFrame();
  }
}

function mfRadarViewport(width, height) {
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

function mfWorldToScreen(worldX, worldY, viewport) {
  const overview = mfRadarAsset.overview;
  const radarX = (Number(worldX) - overview.posX) / overview.scale;
  const radarY = (overview.posY - Number(worldY)) / overview.scale;
  const imageW = Math.max(1, mfRadarImage.naturalWidth);
  const imageH = Math.max(1, mfRadarImage.naturalHeight);
  return [viewport.x + (radarX / imageW) * viewport.w, viewport.y + (radarY / imageH) * viewport.h];
}

drawCurrentFrame = function() {
  if (viewMode !== 'tactical') return;
  if (!mfRadarAsset || !mfRadarImage) { mfOriginalDrawCurrentFrame(); return; }
  const { width, height } = resizeCanvas();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, width, height);
  const viewport = mfRadarViewport(width, height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = .9;
  ctx.drawImage(mfRadarImage, viewport.x, viewport.y, viewport.w, viewport.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(viewport.x + .5, viewport.y + .5, viewport.w - 1, viewport.h - 1);
  ctx.restore();
  const frame = nearestFrame(currentTick);
  if (!frame) return;
  const selected = playerInFrame(frame, selectedPlayer);
  if (selected && Number.isFinite(selected.X) && Number.isFinite(selected.Y)) {
    const [px, py] = mfWorldToScreen(selected.X, selected.Y, viewport);
    drawVision(px, py, Number(selected.yaw || 0), Math.min(viewport.w, viewport.h) * .19);
  }
  for (const player of frame.players) {
    if (!Number.isFinite(player.X) || !Number.isFinite(player.Y)) continue;
    const [x, y] = mfWorldToScreen(player.X, player.Y, viewport);
    if (x < viewport.x - 12 || x > viewport.x + viewport.w + 12 || y < viewport.y - 12 || y > viewport.y + viewport.h + 12) continue;
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
    const rad = (Number(player.yaw || 0) - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(rad) * 14, y + Math.sin(rad) * 14);
    ctx.strokeStyle = isSelected ? '#f4f4f5' : color; ctx.lineWidth = 1.6; ctx.stroke();
    if (isSelected || width > 760) {
      ctx.font = '10px "Segoe UI", sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)';
      ctx.strokeText(player.name || 'Player', x + 9, y - 8); ctx.fillStyle = isSelected ? '#fff' : '#d3d3d8';
      ctx.fillText(player.name || 'Player', x + 9, y - 8);
    }
    ctx.restore();
  }
  updateSelectedHud(frame);
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = 'rgba(240,240,242,.48)';
  ctx.fillText(`VALVE RADAR · ${mfRadarAsset.map.toUpperCase()} · ${formatTick(frame.tick)}`, viewport.x + 10, viewport.y + viewport.h - 10);
};
