const $ = (id) => document.getElementById(id);
let demo = null;
let currentTick = 0;
let selectedPlayer = null;
let selectedPlayerButton = null;
let consoleOpen = false;
let playing = false;
let viewMode = 'tactical';
let lastFrameTime = performance.now();
let historyIndex = -1;
let povMap = null;
let povPreparing = false;
let voiceGeneration = 0;
const history = [];
const voiceTracks = new Map();
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

function clearVoice() {
  voiceGeneration++;
  for (const track of voiceTracks.values()) {
    track.audio.pause();
    track.audio.src = '';
  }
  voiceTracks.clear();
  $('voiceStatus').classList.add('hidden');
}

function loadDemo(result) {
  clearVoice();
  window.matchframePov?.reset();
  povMap = null;
  povPreparing = false;
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
  $('emptyState').classList.add('hidden');
  $('viewerWarning').classList.toggle('hidden', !result.viewerError);
  if (result.viewerError) $('viewerWarning').textContent = `Replay bu demoda tam parse edilemedi: ${result.viewerError}`;
  renderRoundSelector();
  renderPlayers(result.players || []);
  selectDefaultPlayer(result.players || []);
  updateTimeLabel();
  setViewMode('tactical');
  drawCurrentFrame();
  // Analiz modeli demo yüklendiğinde BİR KEZ kurulur (yeni sol panel ekranları).
  window.MF?.store?.setDemo(demo);
  const frameCount = result.frames?.length || 0;
  $('viewerLabel').textContent = frameCount ? `${frameCount.toLocaleString('tr-TR')} replay frame` : 'Event-only demo';
  log(`Loaded ${map}: ${(result.players || []).length} players, ${frameCount} replay frames, ${formatClock(result.durationSeconds || 0)}`, 'ok');
  prepareVoice(result.file);
}

function playerInitial(name, index = 0) {
  const text = String(name || '').trim();
  return (text[0] || String(index + 1)).toUpperCase();
}

function renderPlayers(players) {
  const selectedSteam = String(selectedPlayer?.steamid || '');
  $('playerCount').textContent = players.length;
  $('playersList').innerHTML = '';
  selectedPlayerButton = null;
  players.forEach((player, index) => {
    const row = document.createElement('button');
    row.className = 'player';
    row.innerHTML = `<span class="avatar neutral"></span><span class="ptext"><span class="pname"></span><span class="pmeta"></span></span><span class="voice-slot"></span>`;
    row.querySelector('.avatar').textContent = playerInitial(player.name, index);
    row.querySelector('.pname').textContent = player.name || `Player ${index + 1}`;
    row.querySelector('.pmeta').textContent = player.steamid || 'Unknown SteamID';
    const steamid = String(player.steamid || '');
    const voice = voiceTracks.get(steamid);
    if (voice) {
      const voiceButton = document.createElement('button');
      voiceButton.className = `voice-toggle${voice.enabled ? ' active' : ''}`;
      voiceButton.type = 'button';
      voiceButton.title = voice.enabled ? 'Oyun içi sesi kapat' : 'Oyun içi sesi aç';
      voiceButton.textContent = voice.enabled ? 'Ses açık' : 'Ses';
      voiceButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        voice.enabled = !voice.enabled;
        voiceButton.classList.toggle('active', voice.enabled);
        voiceButton.textContent = voice.enabled ? 'Ses açık' : 'Ses';
        voiceButton.title = voice.enabled ? 'Oyun içi sesi kapat' : 'Oyun içi sesi aç';
        syncVoice(true);
      };
      row.querySelector('.voice-slot').appendChild(voiceButton);
    }
    row.onclick = () => selectPlayer(player, row);
    $('playersList').appendChild(row);
    if (selectedSteam && steamid === selectedSteam) selectedPlayerButton = row;
  });
  if (selectedPlayerButton) selectedPlayerButton.classList.add('active');
}

function selectDefaultPlayer(players) {
  if (!players.length) return;
  const preferred = players.find((p) => /pifo/i.test(String(p.name || ''))) || players[0];
  const buttons = [...document.querySelectorAll('.player')];
  const index = players.indexOf(preferred);
  selectPlayer(preferred, buttons[index] || buttons[0]);
}

function selectPlayer(player, button) {
  selectedPlayer = player;
  // Yeni sol panel ekranları replay seçimini aynı filtre üzerinden paylaşır.
  window.MF?.filters?.setPlayerFromReplay(player?.steamid);
  if (selectedPlayerButton) selectedPlayerButton.classList.remove('active');
  selectedPlayerButton = button || null;
  if (button) button.classList.add('active');
  $('povHud').classList.remove('hidden');
  $('selectedName').textContent = player.name || 'Player';
  $('selectedTeam').textContent = Number(player.team_number) === 2 ? 'T' : Number(player.team_number) === 3 ? 'CT' : '—';
  renderTimelineMarkers();
  updateSelectedHud();
  if (viewMode === 'pov') updatePovCamera();
  else drawCurrentFrame();
}

function playerMatchesEvent(event, role) {
  if (!selectedPlayer) return false;
  const steam = String(selectedPlayer.steamid || '');
  const name = String(selectedPlayer.name || '');
  const steamKeys = [`${role}_steamid`, `${role}_xuid`, `${role}_player_steamid`];
  for (const key of steamKeys) {
    if (steam && event[key] != null && String(event[key]) === steam) return true;
  }
  const nameKeys = [`${role}_name`, `${role}_player_name`];
  for (const key of nameKeys) {
    if (name && event[key] != null && String(event[key]) === name) return true;
  }
  return false;
}

function opponentName(event, role) {
  return String(event[`${role}_name`] || event[`${role}_player_name`] || event[role] || '?');
}

function renderTimelineMarkers() {
  const layer = $('timelineMarkers');
  layer.innerHTML = '';
  if (!demo || !selectedPlayer || !demo.maxTick) return;
  const events = [];
  for (const event of demo.deaths || []) {
    const tick = Number(event.tick || 0);
    if (!tick) continue;
    if (playerMatchesEvent(event, 'attacker') && !playerMatchesEvent(event, 'user')) {
      events.push({ tick, kind: 'kill', text: `Kill · ${opponentName(event, 'user')}` });
    }
    if (playerMatchesEvent(event, 'user')) {
      events.push({ tick, kind: 'death', text: `Ölüm · ${opponentName(event, 'attacker')}` });
    }
  }
  for (const event of events) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = `timeline-marker ${event.kind}`;
    marker.style.left = `${Math.max(0, Math.min(100, event.tick / demo.maxTick * 100))}%`;
    marker.title = `${event.text} · ${formatTick(event.tick)}`;
    marker.setAttribute('aria-label', marker.title);
    marker.onclick = (e) => { e.preventDefault(); seek(event.tick); };
    layer.appendChild(marker);
  }
}

function renderRoundSelector() {
  const select = $('roundSelect');
  select.innerHTML = '<option value="">Tur —</option>';
  for (const round of demo?.roundMeta || []) {
    const option = document.createElement('option');
    option.value = String(round.startTick);
    option.textContent = `Tur ${round.number}`;
    select.appendChild(option);
  }
}

function currentRoundIndex() {
  const rounds = demo?.roundMeta || [];
  if (!rounds.length) return -1;
  let result = 0;
  for (let i = 0; i < rounds.length; i++) {
    if (currentTick >= rounds[i].startTick) result = i;
    else break;
  }
  return result;
}

function updateRoundSelect() {
  const index = currentRoundIndex();
  const round = demo?.roundMeta?.[index];
  if (round) $('roundSelect').value = String(round.startTick);
}

function jumpRound(direction) {
  const rounds = demo?.roundMeta || [];
  if (!rounds.length) return;
  const current = currentRoundIndex();
  const target = Math.max(0, Math.min(rounds.length - 1, current + direction));
  seek(rounds[target].startTick);
}

$('prevRound').onclick = () => jumpRound(-1);
$('nextRound').onclick = () => jumpRound(1);
$('roundSelect').onchange = (event) => {
  if (event.target.value !== '') seek(Number(event.target.value));
};

$('launchBtn').onclick = async () => {
  if (!demo) return;
  try {
    await window.matchframe.demo.launch(demo.file);
    log(`CS2 launch requested for ${demo.file.split(/[\\/]/).pop()}`, 'ok');
    setTimeout(refreshCore, 5000);
  } catch (error) { log(error.message, 'error'); openConsole(true); }
};

function tickRate() { return Number(demo?.tickRate || 64) || 64; }
function formatClock(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function formatTick(tick) { return formatClock(Number(tick || 0) / tickRate()); }

function updateTimeLabel() {
  if (!demo) { $('timeLabel').textContent = '00:00 / 00:00'; return; }
  $('timeline').value = currentTick;
  $('timeLabel').textContent = `${formatTick(currentTick)} / ${formatTick(demo.maxTick || 0)}`;
  updateRoundSelect();
}

async function seek(tick) {
  if (!demo) return;
  currentTick = Math.max(0, Math.min(Number(demo.maxTick || 0), Number(tick || 0)));
  updateTimeLabel();
  if (viewMode === 'pov') updatePovCamera();
  else drawCurrentFrame();
  syncVoice(true);
  window.MF?.bus?.emit('replay:seek', { tick: currentTick });
}

$('timeline').oninput = (event) => seek(event.target.value);
$('pauseBtn').onclick = () => {
  if (!demo) return;
  playing = !playing;
  $('pauseBtn').textContent = playing ? 'Ⅱ' : '▶';
  lastFrameTime = performance.now();
  syncVoice(true);
};
$('speed').onchange = () => syncVoice(true);

$('tacticalTab').onclick = () => setViewMode('tactical');
$('povTab').onclick = () => activateOfflinePov();

function setViewMode(mode) {
  viewMode = mode;
  $('tacticalTab').classList.toggle('active', mode === 'tactical');
  $('povTab').classList.toggle('active', mode === 'pov');
  canvas.classList.toggle('hidden', mode !== 'tactical');
  $('povCanvas').classList.toggle('hidden', mode !== 'pov' || !window.matchframePov?.isReady());
  $('povState').classList.toggle('hidden', mode !== 'pov' || window.matchframePov?.isReady());
  const grid = document.querySelector('.viewport-grid');
  if (grid) grid.classList.toggle('hidden', mode === 'pov');
  if (mode === 'tactical') drawCurrentFrame();
  else { window.matchframePov?.resize(); updatePovCamera(); }
}

async function activateOfflinePov() {
  if (!demo || povPreparing) return;
  setViewMode('pov');
  const map = String(demo.header?.map_name || '').toLowerCase();
  if (window.matchframePov?.isReady() && povMap === map) {
    $('povCanvas').classList.remove('hidden');
    $('povState').classList.add('hidden');
    updatePovCamera();
    return;
  }
  povPreparing = true;
  $('povCanvas').classList.add('hidden');
  $('povState').classList.remove('hidden');
  $('povStateTitle').textContent = 'Offline POV hazırlanıyor';
  $('povStateText').textContent = 'İlk açılışta Source 2 Viewer indirilir ve yerel CS2 map dosyası GLB cache’e dönüştürülür. CS2.exe açılmaz.';
  $('viewerLabel').textContent = `${map} 3D map hazırlanıyor`;
  try {
    const prepared = await window.matchframe.pov.prepare(map);
    await window.matchframePov.load(prepared.url);
    povMap = map;
    if (viewMode === 'pov') {
      $('povCanvas').classList.remove('hidden');
      $('povState').classList.add('hidden');
    }
    $('viewerLabel').textContent = `Offline POV · ${prepared.renderer}`;
    updatePovCamera();
  } catch (error) {
    $('povStateTitle').textContent = 'Offline POV hazırlanamadı';
    $('povStateText').textContent = error.message;
    $('viewerLabel').textContent = 'Offline POV hatası';
    log(`Offline POV: ${error.message}`, 'error');
  } finally { povPreparing = false; }
}

function updatePovCamera() {
  if (viewMode !== 'pov' || !window.matchframePov?.isReady()) return;
  const frame = nearestFrame(currentTick);
  const player = playerInFrame(frame, selectedPlayer);
  if (player) window.matchframePov.setPlayer(player);
  updateSelectedHud(frame);
}

async function prepareVoice(file) {
  const generation = voiceGeneration;
  try {
    const result = await window.matchframe.voice.prepare(file);
    if (generation !== voiceGeneration || !demo || demo.file !== file) return;
    if (!result?.available || !result.tracks?.length) {
      $('voiceStatus').classList.add('hidden');
      return;
    }
    for (const item of result.tracks) {
      const audio = new Audio(item.url);
      audio.preload = 'metadata';
      audio.volume = 1;
      voiceTracks.set(String(item.steamid), { audio, enabled: false });
    }
    $('voiceStatus').textContent = `${voiceTracks.size} oyuncunun oyun içi sesi mevcut`;
    $('voiceStatus').classList.remove('hidden');
    const selectedSteam = String(selectedPlayer?.steamid || '');
    renderPlayers(demo.players || []);
    if (selectedSteam) {
      const player = (demo.players || []).find((p) => String(p.steamid || '') === selectedSteam);
      const row = [...document.querySelectorAll('.player')].find((el) => el.querySelector('.pmeta')?.textContent === selectedSteam);
      if (player) selectPlayer(player, row || null);
    }
    log(`Demo voice ready: ${voiceTracks.size} player tracks`, 'ok');
  } catch (error) {
    if (generation !== voiceGeneration) return;
    $('voiceStatus').classList.add('hidden');
    log(`Voice extraction unavailable: ${error.message}`, 'system');
  }
}

function syncVoice(force = false) {
  if (!demo) return;
  const second = currentTick / tickRate();
  const speed = Number($('speed').value || 1);
  for (const track of voiceTracks.values()) {
    const audio = track.audio;
    audio.playbackRate = speed;
    if (!track.enabled) { audio.pause(); continue; }
    if (force || !Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime - second) > 0.3) {
      try { audio.currentTime = Math.min(second, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.02) : second); } catch (_) {}
    }
    if (playing) audio.play().catch(() => {}); else audio.pause();
  }
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

function playerInFrame(frame, player) {
  if (!frame || !player) return null;
  const steam = String(player.steamid || '');
  const name = String(player.name || '');
  return frame.players.find((p) => (steam && String(p.steamid) === steam) || (!steam && p.name === name)) || null;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
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
  const selected = playerInFrame(frame, selectedPlayer);
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
    if (isSelected) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = '#f0f0f2'; ctx.lineWidth = 1.5; ctx.stroke(); }
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
  ctx.font = '9px Consolas, monospace'; ctx.fillStyle = '#5f5f66';
  ctx.fillText(`RECONSTRUCTED · ${formatTick(frame.tick)}`, 12, height - 12);
}

function drawBackdrop(width, height) {
  ctx.strokeStyle = 'rgba(255,255,255,.025)'; ctx.lineWidth = 1;
  for (let x = 24; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 24; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
}

function drawVision(x, y, yaw, length) {
  const a = (yaw - 90) * Math.PI / 180;
  const spread = 32 * Math.PI / 180;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, length);
  grad.addColorStop(0, 'rgba(240,240,242,.12)'); grad.addColorStop(1, 'rgba(240,240,242,0)');
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, length, a - spread, a + spread); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
}

function updateSelectedHud(frame = nearestFrame(currentTick)) {
  if (!selectedPlayer || !frame) return;
  const p = playerInFrame(frame, selectedPlayer);
  if (!p) return;
  $('selectedHealth').textContent = `${Math.max(0, Math.round(p.health || 0))} HP`;
  $('selectedYaw').textContent = `${Math.round(p.yaw || 0)}°`;
  $('selectedTeam').textContent = Number(p.team_num) === 2 ? 'T' : Number(p.team_num) === 3 ? 'CT' : '—';
}

function playbackLoop(now) {
  const dt = Math.min(.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (playing && demo) {
    const speed = Number($('speed').value || 1);
    currentTick += dt * tickRate() * speed;
    if (currentTick >= Number(demo.maxTick || 0)) {
      currentTick = Number(demo.maxTick || 0);
      playing = false;
      $('pauseBtn').textContent = '▶';
      syncVoice(true);
    }
    updateTimeLabel();
    if (viewMode === 'pov') updatePovCamera(); else drawCurrentFrame();
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) syncVoice(false);
  }
  requestAnimationFrame(playbackLoop);
}
requestAnimationFrame(playbackLoop);
new ResizeObserver(() => { if (viewMode === 'pov') window.matchframePov?.resize(); else drawCurrentFrame(); }).observe($('viewport'));

function openConsole(force) {
  consoleOpen = force ?? !consoleOpen;
  $('consolePanel').classList.toggle('open', consoleOpen);
  $('consolePanel').setAttribute('aria-hidden', String(!consoleOpen));
  if (consoleOpen) setTimeout(() => $('consoleInput').focus(), 30);
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Backquote' && !event.ctrlKey && !event.altKey) { event.preventDefault(); openConsole(); }
  if (!consoleOpen && event.key === 'ArrowLeft' && event.shiftKey) jumpRound(-1);
  if (!consoleOpen && event.key === 'ArrowRight' && event.shiftKey) jumpRound(1);
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
  } catch (error) { log(error.message, 'error'); }
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
    event.preventDefault(); if (history.length) input.value = history[Math.min(++historyIndex, history.length - 1)];
  } else if (event.key === 'ArrowDown') {
    event.preventDefault(); historyIndex = Math.max(-1, historyIndex - 1); input.value = historyIndex < 0 ? '' : history[historyIndex];
  } else if (event.key === 'Escape') openConsole(false);
});

function renderSuggestions() {
  const value = input.value.trim().toLowerCase();
  const results = value ? CS2_COMMANDS.filter((x) => x.startsWith(value)).slice(0, 8) : [];
  $('suggestions').innerHTML = '';
  results.forEach((command) => {
    const item = document.createElement('div'); item.className = 'suggestion'; item.textContent = command;
    item.onmousedown = (event) => { event.preventDefault(); input.value = `${command} `; $('suggestions').classList.remove('show'); input.focus(); };
    $('suggestions').appendChild(item);
  });
  $('suggestions').classList.toggle('show', results.length > 0);
}

/*
 * Yeni modüler ekranlar (Analysis / Aim / Utility) eski replay kodunu
 * override etmez; yalnızca bu köprü üzerinden okur/yazar. Burada global
 * fonksiyonlara canlı referans verilir, böylece enhance.js/radar.js
 * override'ları otomatik olarak geçerli olur.
 */
window.MatchFrameBridge = {
  getDemo: () => demo,
  getCurrentTick: () => currentTick,
  getSelectedPlayer: () => selectedPlayer,
  getSelectedSteamId: () => String(selectedPlayer?.steamid || ''),
  getViewMode: () => viewMode,
  isPlaying: () => playing,
  tickRate,
  seek: (tick) => seek(tick),
  redraw: () => {
    if (!demo) return;
    if (viewMode === 'pov') updatePovCamera();
    else drawCurrentFrame();
  },
  resizePov: () => {
    if (viewMode === 'pov') window.matchframePov?.resize();
  },
  pause: () => {
    if (!playing) return;
    playing = false;
    $('pauseBtn').textContent = '▶';
    syncVoice(true);
  },
  selectSteamId(steamId) {
    const value = String(steamId || '');
    if (!value || !demo) return false;
    if (value === String(selectedPlayer?.steamid || '')) return true;
    const player = (demo.players || []).find((item) => String(item.steamid || '') === value);
    if (!player) return false;
    const rows = [...document.querySelectorAll('.player')];
    const row = rows.find((element) => String(element.dataset?.steamid || '') === value)
      || rows.find((element) => element.querySelector('.pmeta')?.textContent === value)
      || null;
    selectPlayer(player, row);
    return true;
  },
  openDemo: () => $('openBtn')?.click(),
  log
};

refreshCore();
setInterval(refreshCore, 7000);
