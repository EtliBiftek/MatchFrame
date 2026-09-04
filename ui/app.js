const $ = (id) => document.getElementById(id);
let demo = null;
let currentTick = 0;
let selectedPlayer = null;
let consoleOpen = false;
let paused = false;
const history = [];
let historyIndex = -1;

const CS2_COMMANDS = [
  'demo_gototick','demo_timescale','demo_togglepause','demo_info','demo_resume','demo_pause',
  'spec_mode','spec_next','spec_prev','spec_player','spec_goto','spec_lerpto','spec_lock_to_accountid',
  'cl_drawhud','cl_showfps','cl_draw_only_deathnotices','r_drawviewmodel','voice_enable','volume',
  'sv_showimpacts','sv_showimpacts_time','mat_fullbright','host_timescale','thirdperson','firstperson',
  'mirv_cmd','mirv_campath','mirv_camio','mirv_fov','mirv_input','mirv_time','mirv_cvar_unhide_all'
];

$('minimize').onclick = () => window.matchframe.window.minimize();
$('maximize').onclick = () => window.matchframe.window.maximize();
$('close').onclick = () => window.matchframe.window.close();

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
    $('coreDot').classList.add('good');
    $('coreLabel').textContent = `Core ${response.data?.version || 'online'}`;
    const cs = await window.matchframe.core.request('cs2_status');
    const running = Boolean(cs.data?.running);
    $('cs2Dot').classList.toggle('good', running);
    $('cs2Label').textContent = running ? 'CS2 çalışıyor' : 'CS2 kapalı';
  } catch (error) {
    $('coreLabel').textContent = 'Core offline';
  }
}

$('openBtn').onclick = async () => {
  $('openBtn').disabled = true;
  $('openBtn').textContent = 'Parsing...';
  try {
    const result = await window.matchframe.demo.open();
    if (!result.canceled) loadDemo(result);
  } catch (error) {
    log(`Demo parse error: ${error.message}`, 'error');
    openConsole(true);
  } finally {
    $('openBtn').disabled = false;
    $('openBtn').textContent = 'Demo Aç';
  }
};

function loadDemo(result) {
  demo = result;
  currentTick = 0;
  const map = result.header?.map_name || 'Unknown map';
  const server = result.header?.server_name || 'CS2 Demo';
  $('matchTitle').textContent = map;
  $('matchSubtitle').textContent = `${server} • ${result.file.split(/[\\/]/).pop()}`;
  $('mapBadge').textContent = map.toUpperCase();
  $('launchBtn').disabled = false;
  $('timeline').max = Math.max(1, result.maxTick || 1);
  $('timeline').value = 0;
  $('tickLabel').textContent = `Tick 0 / ${result.maxTick || 0}`;
  document.querySelector('.empty-state').classList.add('hidden');
  renderPlayers(result.players || []);
  renderEvents(result.rounds || [], result.deaths || []);
  log(`Loaded ${map}: ${(result.players || []).length} players, max tick ${result.maxTick || 0}`, 'ok');
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
    button.onclick = () => selectPlayer(player, button);
    $('playersList').appendChild(button);
  });
}

function selectPlayer(player, button) {
  selectedPlayer = player;
  document.querySelectorAll('.player').forEach((x) => x.classList.remove('active'));
  button.classList.add('active');
  $('playerOverlay').classList.remove('hidden');
  $('selectedName').textContent = player.name || 'Player';
  $('selectedMeta').textContent = `${player.team_number === 2 ? 'T' : 'CT'} • ${player.steamid || ''}`;
}

function renderEvents(rounds, deaths) {
  const items = [
    ...rounds.map((x) => ({ tick: Number(x.tick || 0), kind: 'Round end', text: x.winner ? `Winner ${x.winner}` : 'Round completed' })),
    ...deaths.map((x) => ({ tick: Number(x.tick || 0), kind: 'Kill', text: `${x.attacker_name || x.attacker || '?'} → ${x.user_name || x.user || '?'}` }))
  ].filter((x) => x.tick).sort((a,b) => a.tick - b.tick);
  $('eventCount').textContent = `${items.length} EVENTS`;
  $('eventRail').innerHTML = '';
  items.slice(0, 300).forEach((event) => {
    const chip = document.createElement('button');
    chip.className = 'event-chip';
    chip.innerHTML = '<b></b><span></span>';
    chip.querySelector('b').textContent = event.kind;
    chip.querySelector('span').textContent = `Tick ${event.tick}`;
    chip.title = event.text;
    chip.onclick = () => seek(event.tick, true);
    $('eventRail').appendChild(chip);
  });
}

$('launchBtn').onclick = async () => {
  if (!demo) return;
  try {
    await window.matchframe.demo.launch(demo.file);
    log(`CS2 launch requested: playdemo ${demo.file}`, 'ok');
    setTimeout(refreshCore, 5000);
  } catch (error) { log(error.message, 'error'); openConsole(true); }
};

async function seek(tick, send = true) {
  if (!demo) return;
  currentTick = Math.max(0, Math.min(Number(demo.maxTick || 0), Number(tick || 0)));
  $('timeline').value = currentTick;
  $('tickLabel').textContent = `Tick ${currentTick} / ${demo.maxTick || 0}`;
  if (send) await sendCommand(`demo_gototick ${Math.round(currentTick)}`, false);
}
$('timeline').oninput = (event) => seek(event.target.value, false);
$('timeline').onchange = (event) => seek(event.target.value, true);
$('backTick').onclick = () => seek(currentTick - 64, true);
$('forwardTick').onclick = () => seek(currentTick + 64, true);
$('pauseBtn').onclick = async () => {
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶' : 'Ⅱ';
  await sendCommand('demo_togglepause', false);
};
$('speed').onchange = (event) => sendCommand(`demo_timescale ${event.target.value}`, false);

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
  const results = value ? CS2_COMMANDS.filter((x) => x.startsWith(value)).slice(0, 7) : [];
  $('suggestions').innerHTML = '';
  results.forEach((command) => {
    const item = document.createElement('div'); item.className = 'suggestion'; item.textContent = command;
    item.onmousedown = (event) => { event.preventDefault(); input.value = `${command} `; $('suggestions').classList.remove('show'); input.focus(); };
    $('suggestions').appendChild(item);
  });
  $('suggestions').classList.toggle('show', results.length > 0);
}

refreshCore();
setInterval(refreshCore, 7000);
