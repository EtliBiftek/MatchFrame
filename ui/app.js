const $ = (id) => document.getElementById(id);
let demo = null;
let currentTick = 0;
let selectedPlayer = null;
let selectedPlayerButton = null;
let consoleOpen = false;
let playing = false;
let viewMode = 'tactical';
let lastFrameTime = performance.now();
let captureStream = null;
let historyIndex = -1;
const history = [];
const canvas = $('replayCanvas');
const ctx = canvas.getContext('2d');

const CS2_COMMANDS = [
  'demo_goto','demo_gototick','demo_gotomark','demo_marktick','demo_timescale','demo_togglepause','demo_info','demo_resume','demo_pause','demo_pauseatservertick',
  'spec_mode','spec_next','spec_prev','spec_player','spec_goto','spec_pos','spec_show_xray','spec_lock_to_current_player',
  'cl_drawhud','cl_showfps','cl_draw_only_deathnotices','r_drawviewmodel','voice_enable','volume','host_timescale','thirdperson','firstperson',
  'sv_showimpacts','sv_showimpacts_time','mat_fullbright','mirv_cmd','mirv_campath','mirv_camio','mirv_fov','mirv_input','mirv_time','mirv_cvar_unhide_all'
];

$('minimize').onclick = () => window.matchframe.window.minimize();
$('maximize').onclick = () => window.matchframe.window.maximize();
$('close').onclick = () => window.matchframe.window.close();

function setDot(id, good) {
  const el = $(id);
  if (el) el.classList.toggle('good', Boolean(good));
}

function log(text, type = '') {
  const line = document.createElement('div');
  line.className = `log ${type}`;
  line.textContent = text;
  $('consoleOutput').appendChild(line);
  $('consoleOutput').scrollTop = $('consoleOutput').scrollHeight;
}

async function refreshCore() {
  try {
    const response = await window.matchframe.core.status();
    setDot('coreDot', true); setDot('coreDotFooter', true);
    $('coreLabel').textContent = `Core ${response.data?.version || 'online'}`;
    const cs = await window.matchframe.core.request('cs2_status');
    const running = Boolean(cs.data?.running);
    setDot('cs2Dot', running); setDot('cs2DotFooter', running);
    $('cs2Label').textContent = running ? 'CS2 çalışıyor' : 'CS2 kapalı';
  } catch (_) {
    setDot('coreDot', false); setDot('coreDotFooter', false);
    $('coreLabel').textContent = 'Core offline';
  }
}

$('openBtn').onclick = async () => {
  $('openBtn').disabled = true;
  $('openBtn').textContent = 'Demo okunuyor…';
  $('viewerLabel').textContent = 'Demo parse ediliyor';
  try {
    const result = await window.matchframe.demo.open();
    if (!result.canceled) loadDemo(result);
  } catch (error) {
    log(`Demo parse error: ${error.message}`, 'error');
    openConsole(true);
    $('viewerLabel').textContent = 'Parse hatası';
  } finally {
    $('openBtn').disabled = false;
    $('openBtn').textContent = 'Demo Aç';
  }
};

function loadDemo(result) {
  stopCapture();
  demo = result;
  currentTick = 0;
  playing = false;
  $('pauseBtn').textContent = '▶';
  const map = result.header?.map_name || 'Unknown map';
  const server = result.header?.server_name || 'CS2 Demo';
  const fileName = result.file.split(/[\\/]/).pop();
  $('matchTitle').textContent = map;
  $('matchSubtitle').textContent = `${server} · ${fileName}`;
  $('mapBadge').textContent = map.toUpperCase();
  $('launchBtn').disabled = false;
  $('timeline').max = Math.max(1, result.maxTick || 1);
  $('timeline').value = 0;
  updateTickLabel();
  $('emptyState').classList.add('hidden');
  $('viewerWarning').classList.toggle('hidden', !result.viewerError);
  if (result.viewerError) {
    $('viewerWarning').textContent = `Reconstructed viewer bu demoda tam parse edilemedi: ${result.viewerError}`;
  }
  renderPlayers(result.players || []);
  renderEvents(result);
  selectDefaultPlayer(result.players || []);
  setViewMode('tactical');
  drawCurrentFrame();
  const frameCount = result.frames?.length || 0;
  $('viewerLabel').textContent = frameCount ? `${frameCount.toLocaleString('tr-TR')} replay frame` : 'Event-only demo';
  log(`Loaded ${map}: ${(result.players || []).length} players, ${frameCount} replay frames, max tick ${result.maxTick || 0}`, 'ok');
}

function renderPlayers(players) {
  $('playerCount').textContent = players.length;
  $('playersList').innerHTML = '';
  players.forEach((player, index) => {
    const button = document.createElement('button');
    const team = Number(player.team_number) === 2 ? 'T' : Number(player.team_number) === 3 ? 'CT' : '?';
    button.className = 'player';
    button.innerHTML = `<span class="avatar ${team.toLowerCase()}">${team}</span><span class="ptext"><span class="pname"></span><span class="pmeta"></span></span>`;
    button.querySelector('.pname').textContent = player.name || `Player ${index + 1}`;
    button.querySelector('.pmeta').textContent = player.steamid || 'Unknown SteamID';
    button.onclick = () => selectPlayer(player, button, true);
    $('playersList').appendChild(button);
  });
}

function selectDefaultPlayer(players) {
  if (!players.length) return;
  const preferred = players.find((p) => /pifo/i.test(String(p.name || ''))) || players[0];
  const buttons = [...document.querySelectorAll('.player')];
  const index = players.indexOf(preferred);
  selectPlayer(preferred, buttons[index] || buttons[0], false);
}

function selectPlayer(player, button, syncPov) {
  selectedPlayer = player;
  if (selectedPlayerButton) selectedPlayerButton.classList.remove('active');
  selectedPlayerButton = button || null;
  if (button) button.classList.add('active');
  $('povHud').classList.remove('hidden');
  $('selectedName').textContent = player.name || 'Player';
  $('selectedTeam').textContent = Number(player.team_number) === 2 ? 'T' : Number(player.team_number) === 3 ? 'CT' : '—';
  updateSelectedHud();
  drawCurrentFrame();
  if (syncPov && viewMode === 'pov') syncSelectedPlayerToCs2();
}

async function syncSelectedPlayerToCs2() {
  if (!selectedPlayer) return;
  await sendCommand('spec_mode 1', false);
  const safeName = String(selectedPlayer.name || '').replace(/["\\]/g, '');
  if (safeName) await sendCommand(`spec_player "${safeName}"`, false);
}

function renderEvents(result) {
  const rounds = result.rounds || [];
  const deaths = result.deaths || [];
  const plants = result.plants || [];
  const defuses = result.defuses || [];
  const explosions = result.explosions || [];
  const items = [
    ...rounds.map((x) => ({ tick: Number(x.tick || 0), kind: 'Round end', text: x.winner ? `Winner ${x.winner}` : 'Round completed' })),
    ...deaths.map((x) => ({ tick: Number(x.tick || 0), kind: 'Kill', text: `${x.attacker_name || x.attacker || '?'} → ${x.user_name || x.user || '?'}` })),
    ...plants.map((x) => ({ tick: Number(x.tick || 0), kind: 'Bomb planted', text: x.user_name || 'Plant' })),
    ...defuses.map((x) => ({ tick: Number(x.tick || 0), kind: 'Bomb defused', text: x.user_name || 'Defuse' })),
    ...explosions.map((x) => ({ tick: Number(x.tick || 0), kind: 'Bomb exploded', text: 'Explosion' }))
  ].filter((x) => x.tick).sort((a, b) => a.tick - b.tick);
  $('eventCount').textContent = `${items.length} EVENTS`;
  $('eventRail').innerHTML = '';
  if (!items.length) {
    $('eventRail').innerHTML = '<span class="rail-empty">Event bulunamadı.</span>';
    return;
  }
  items.slice(0, 420).forEach((event) => {
    const chip = document.createElement('button');
    chip.className = 'event-chip';
    chip.innerHTML = '<b></b><span></span>';
    chip.querySelector('b').textContent = event.kind;
    chip.querySelector('span').textContent = `Tick ${event.tick}`;
    chip.title = event.text;
    chip.onclick = () => seek(event.tick, viewMode === 'pov');
    $('eventRail').appendChild(chip);
  });
}

$('launchBtn').onclick = async () => {
  if (!demo) return;
  try {
    await window.matchframe.demo.launch(demo.file);
    log(`CS2 launch requested: playdemo ${demo.file}`, 'ok');
    $('viewerLabel').textContent = 'CS2 açılıyor';
    setTimeout(refreshCore, 5000);
  } catch (error) {
    log(error.message, 'error');
    openConsole(true);
  }
};

function updateTickLabel() {
  $('timeline').value = currentTick;
  $('tickLabel').textContent = `Tick ${Math.round(currentTick)} / ${demo?.maxTick || 0}`;
}

async function seek(tick, syncCs2 = false) {
  if (!demo) return;
  currentTick = Math.max(0, Math.min(Number(demo.maxTick || 0), Number(tick || 0)));
  updateTickLabel();
  drawCurrentFrame();
  if (syncCs2) await sendCommand(`demo_gototick ${Math.round(currentTick)}`, false);
}

$('timeline').oninput = (event) => seek(event.target.value, false);
$('timeline').onchange = (event) => seek(event.target.value, viewMode === 'pov');
$('backTick').onclick = () => seek(currentTick - 64, viewMode === 'pov');
$('forwardTick').onclick = () => seek(currentTick + 64, viewMode === 'pov');
$('pauseBtn').onclick = async () => {
  if (!demo) return;
  playing = !playing;
  $('pauseBtn').textContent = playing ? 'Ⅱ' : '▶';
  lastFrameTime = performance.now();
  if (viewMode === 'pov') await sendCommand('demo_togglepause', false);
};
$('speed').onchange = async (event) => {
  if (viewMode === 'pov') await sendCommand(`demo_timescale ${event.target.value}`, false);
};

$('tacticalTab').onclick = () => setViewMode('tactical');
$('povTab').onclick = () => activateRealPov();

function setViewMode(mode) {
  viewMode = mode;
  $('tacticalTab').classList.toggle('active', mode === 'tactical');
  $('povTab').classList.toggle('active', mode === 'pov');
  canvas.classList.toggle('hidden', mode !== 'tactical');
  $('povVideo').classList.toggle('hidden', mode !== 'pov' || !captureStream);
  $('captureState').classList.toggle('hidden', mode !== 'pov' || Boolean(captureStream));
  if (mode === 'tactical') {
    $('viewerLabel').textContent = `${demo?.frames?.length || 0} replay frame`;
    drawCurrentFrame();
  }
}

async function activateRealPov() {
  if (!demo) return;
  setViewMode('pov');
  $('captureTitle').textContent = 'CS2 görüntüsü hazırlanıyor';
  $('captureText').textContent = 'Gerçek POV için çalışan CS2 penceresi aranıyor.';
  try {
    const status = await window.matchframe.capture.status();
    if (!status.available) {
      await window.matchframe.demo.launch(demo.file);
      $('captureTitle').textContent = 'CS2 açılıyor';
      $('captureText').textContent = 'Oyun ve demo açıldıktan sonra Gerçek POV düğmesine tekrar tıkla.';
      $('viewerLabel').textContent = 'CS2 bekleniyor';
      setTimeout(refreshCore, 4500);
      return;
    }
    stopCapture();
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = $('povVideo');
    video.srcObject = captureStream;
    video.classList.remove('hidden');
    $('captureState').classList.add('hidden');
    await video.play();
    for (const track of captureStream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        captureStream = null;
        if (viewMode === 'pov') {
          video.classList.add('hidden');
          $('captureState').classList.remove('hidden');
          $('captureTitle').textContent = 'POV bağlantısı kesildi';
          $('captureText').textContent = 'Gerçek POV düğmesine basarak tekrar bağlanabilirsin.';
        }
      });
    }
    $('viewerLabel').textContent = `CS2 capture · ${status.name || 'window'}`;
    await sendCommand(`demo_gototick ${Math.round(currentTick)}`, false);
    await syncSelectedPlayerToCs2();
  } catch (error) {
    log(`POV capture: ${error.message}`, 'error');
    $('captureTitle').textContent = 'POV bağlanamadı';
    $('captureText').textContent = error.message;
    $('viewerLabel').textContent = 'POV capture hatası';
  }
}

function stopCapture() {
  if (captureStream) {
    captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
  }
  const video = $('povVideo');
  video.srcObject = null;
  video.classList.add('hidden');
}

function nearestFrame(tick) {
  const frames = demo?.frames || [];
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].tick < tick) lo = mid + 1; else hi = mid;
  }
  if (lo === 0) return frames[0];
  const a = frames[lo - 1], b = frames[lo];
  return Math.abs(a.tick - tick) <= Math.abs(b.tick - tick) ? a : b;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawCurrentFrame() {
  if (viewMode !== 'tactical') return;
  const { width, height } = resizeCanvas();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, width, height);
  drawBackdrop(width, height);
  const frame = nearestFrame(currentTick);
  if (!frame || !demo?.bounds) return;
  const bounds = demo.bounds;
  const pad = 46;
  const sx = (width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX);
  const sy = (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(sx, sy);
  const mapW = (bounds.maxX - bounds.minX) * scale;
  const mapH = (bounds.maxY - bounds.minY) * scale;
  const ox = (width - mapW) / 2;
  const oy = (height - mapH) / 2;
  const toScreen = (x, y) => [ox + (x - bounds.minX) * scale, oy + (bounds.maxY - y) * scale];

  const selectedSteam = String(selectedPlayer?.steamid || '');
  const selectedName = String(selectedPlayer?.name || '');
  const selected = frame.players.find((p) => (selectedSteam && String(p.steamid) === selectedSteam) || (!selectedSteam && p.name === selectedName));

  if (selected && Number.isFinite(selected.X) && Number.isFinite(selected.Y)) {
    const [px, py] = toScreen(selected.X, selected.Y);
    drawVision(px, py, Number(selected.yaw || 0), Math.min(width, height) * .22);
  }

  for (const player of frame.players) {
    if (!Number.isFinite(player.X) || !Number.isFinite(player.Y)) continue;
    const [x, y] = toScreen(player.X, player.Y);
    const isSelected = selected && String(player.steamid) === String(selected.steamid);
    const alive = player.is_alive && player.health > 0;
    const color = Number(player.team_num) === 2 ? '#c4a574' : Number(player.team_num) === 3 ? '#7a9bb8' : '#8e8e96';
    ctx.save();
    ctx.globalAlpha = alive ? 1 : .28;
    if (isSelected) {
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = '#f0f0f2'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, isSelected ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    const rad = (Number(player.yaw || 0) - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(rad) * 13, y + Math.sin(rad) * 13); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    if (isSelected || width > 760) {
      ctx.font = '10px "Segoe UI", sans-serif'; ctx.fillStyle = isSelected ? '#f0f0f2' : '#8e8e96';
      ctx.fillText(player.name || 'Player', x + 9, y - 8);
    }
    ctx.restore();
  }
  updateSelectedHud(frame);
  drawCoordinateLabel(width, height, frame.tick);
}

function drawBackdrop(width, height) {
  ctx.strokeStyle = 'rgba(255,255,255,.025)';
  ctx.lineWidth = 1;
  for (let x = 24; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 24; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  const grad = ctx.createRadialGradient(width * .5, height * .48, 10, width * .5, height * .48, Math.max(width, height) * .55);
  grad.addColorStop(0, 'rgba(158,176,194,.035)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
}

function drawVision(x, y, yaw, length) {
  const a = (yaw - 90) * Math.PI / 180;
  const spread = 32 * Math.PI / 180;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, length);
  grad.addColorStop(0, 'rgba(240,240,242,.12)'); grad.addColorStop(1, 'rgba(240,240,242,0)');
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, length, a - spread, a + spread); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
}

function drawCoordinateLabel(width, height, tick) {
  ctx.font = '9px Consolas, monospace'; ctx.fillStyle = '#5f5f66';
  ctx.fillText(`RECONSTRUCTED · TICK ${tick}`, 12, height - 12);
}

function updateSelectedHud(frame = nearestFrame(currentTick)) {
  if (!selectedPlayer || !frame) return;
  const steam = String(selectedPlayer.steamid || '');
  const p = frame.players.find((x) => (steam && String(x.steamid) === steam) || x.name === selectedPlayer.name);
  if (!p) return;
  $('selectedHealth').textContent = `${Math.max(0, Math.round(p.health || 0))} HP`;
  $('selectedYaw').textContent = `${Math.round(p.yaw || 0)}°`;
  $('selectedTeam').textContent = Number(p.team_num) === 2 ? 'T' : Number(p.team_num) === 3 ? 'CT' : '—';
}

function playbackLoop(now) {
  const dt = Math.min(.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (playing && demo && viewMode === 'tactical') {
    const speed = Number($('speed').value || 1);
    currentTick += dt * 64 * speed;
    if (currentTick >= Number(demo.maxTick || 0)) {
      currentTick = Number(demo.maxTick || 0);
      playing = false;
      $('pauseBtn').textContent = '▶';
    }
    updateTickLabel();
    drawCurrentFrame();
  }
  requestAnimationFrame(playbackLoop);
}
requestAnimationFrame(playbackLoop);

new ResizeObserver(() => drawCurrentFrame()).observe($('viewport'));

function openConsole(force) {
  consoleOpen = force ?? !consoleOpen;
  $('consolePanel').classList.toggle('open', consoleOpen);
  $('consolePanel').setAttribute('aria-hidden', String(!consoleOpen));
  if (consoleOpen) setTimeout(() => $('consoleInput').focus(), 30);
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Backquote' && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    openConsole();
  }
});

async function sendCommand(raw, echo = true) {
  const command = String(raw || '').trim();
  if (!command) return;
  if (echo) log(`> ${command}`);
  if (command === 'clear') { $('consoleOutput').innerHTML = ''; return; }
  if (command === 'help') { log(`Built-ins: help, clear, status. CS2 autocomplete: ${CS2_COMMANDS.length} commands.`, 'system'); return; }
  if (command === 'status') { await refreshCore(); log('Status refreshed.', 'ok'); return; }
  try {
    const response = await window.matchframe.core.command(command);
    if (response.ok) log(response.message || `Sent: ${command}`, 'ok');
    else log(response.error || 'Command failed', 'error');
  } catch (error) {
    log(error.message, 'error');
  }
}

const input = $('consoleInput');
input.addEventListener('input', renderSuggestions);
input.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    const value = input.value;
    if (value.trim()) { history.unshift(value); historyIndex = -1; }
    input.value = ''; $('suggestions').classList.remove('show');
    await sendCommand(value);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (history.length) input.value = history[Math.min(++historyIndex, history.length - 1)];
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    historyIndex = Math.max(-1, historyIndex - 1);
    input.value = historyIndex < 0 ? '' : history[historyIndex];
  } else if (event.key === 'Escape') {
    openConsole(false);
  }
});

function renderSuggestions() {
  const value = input.value.trim().toLowerCase();
  const results = value ? CS2_COMMANDS.filter((x) => x.startsWith(value)).slice(0, 8) : [];
  $('suggestions').innerHTML = '';
  results.forEach((command) => {
    const item = document.createElement('div');
    item.className = 'suggestion';
    item.textContent = command;
    item.onmousedown = (event) => {
      event.preventDefault();
      input.value = `${command} `;
      $('suggestions').classList.remove('show');
      input.focus();
    };
    $('suggestions').appendChild(item);
  });
  $('suggestions').classList.toggle('show', results.length > 0);
}

refreshCore();
setInterval(refreshCore, 7000);
