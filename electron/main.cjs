const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const { Worker } = require('node:worker_threads');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'matchframe', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let mainWindow;
let core;
let nextRequestId = 1;
const pending = new Map();
const servedFiles = new Map();
const povJobs = new Map();
const voiceJobs = new Map();

const RADAR_SOURCE = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main';
const RADAR_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const POV_CACHE_VERSION = 'v2';
const VOICE_TOOL_VERSION = 'v3.1.6';
const VOICE_TOOL_URL = `https://github.com/akiver/csgo-voice-extractor/releases/download/${VOICE_TOOL_VERSION}/win32-x64.zip`;
const VOICE_TOOL_SHA256 = '1f5ad987e6aa0e207268992a169f87a6e78c64561353655e424676ee7bfdcb5b';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b0b0d',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function startCore() {
  if (app.isPackaged) {
    const executable = path.join(process.resourcesPath, 'backend', 'matchframe-core.exe');
    core = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    const manifest = path.join(__dirname, '..', 'backend', 'Cargo.toml');
    core = spawn('cargo', ['run', '--quiet', '--release', '--manifest-path', manifest], {
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  const lines = readline.createInterface({ input: core.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver.resolve(message);
      }
    } catch (_) {}
  });
  core.stderr.on('data', (data) => console.error(`[core] ${data}`));
  core.on('exit', (code) => {
    for (const [, resolver] of pending) resolver.reject(new Error(`MatchFrame core exited (${code})`));
    pending.clear();
  });
}

function coreRequest(action, payload = {}) {
  if (!core || core.killed) return Promise.reject(new Error('MatchFrame core is not running'));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Core request timed out: ${action}`));
    }, 8000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    core.stdin.write(`${JSON.stringify({ id, action, payload })}\n`);
  });
}

function parseDemo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'demo-worker.cjs'));
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      worker.terminate();
      return true;
    };
    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        onProgress?.({ percent: message.percent, stage: message.stage });
        return;
      }
      if (!finish()) return;
      message.ok ? resolve(message.data) : reject(new Error(message.error));
    });
    worker.once('error', (error) => {
      if (!finish()) return;
      reject(error);
    });
    worker.postMessage({ file });
  });
}

function steamRoots() {
  const roots = new Set();
  const pf86 = process.env['ProgramFiles(x86)'];
  const pf = process.env.ProgramFiles;
  if (pf86) roots.add(path.join(pf86, 'Steam'));
  if (pf) roots.add(path.join(pf, 'Steam'));
  roots.add('C:\\Program Files (x86)\\Steam');
  return [...roots].filter(fs.existsSync);
}

function steamLibraries() {
  const libs = new Set(steamRoots());
  for (const root of steamRoots()) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        libs.add(match[1].replace(/\\\\/g, '\\'));
      }
    } catch (_) {}
  }
  return [...libs];
}

function findCs2GameRoot() {
  for (const library of steamLibraries()) {
    const candidate = path.join(library, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo');
    if (fs.existsSync(path.join(candidate, 'gameinfo.gi'))) return candidate;
  }
  return null;
}

function parseOverviewText(text) {
  const number = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s+"?(-?[0-9.]+)"?`, 'i'));
    return match ? Number(match[1]) : null;
  };
  const posX = number('pos_x');
  const posY = number('pos_y');
  const scale = number('scale');
  if (![posX, posY, scale].every(Number.isFinite) || scale <= 0) throw new Error('Radar overview koordinatları okunamadı.');
  return { posX, posY, scale, rotate: number('rotate') || 0, zoom: number('zoom') || 1 };
}

async function cacheNeedsRefresh(file) {
  try {
    const stat = await fs.promises.stat(file);
    return Date.now() - stat.mtimeMs > RADAR_CACHE_MAX_AGE;
  } catch (_) { return true; }
}

async function fetchToFile(url, file, binary = true) {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, data);
}

async function loadRadarAsset(mapName) {
  const map = String(mapName || '').trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(map)) throw new Error('Geçersiz map adı.');
  const cacheDir = path.join(app.getPath('userData'), 'radars');
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const imagePath = path.join(cacheDir, `${map}_radar_psd.png`);
  const infoPath = path.join(cacheDir, `${map}.txt`);
  const imageRefresh = await cacheNeedsRefresh(imagePath);
  const infoRefresh = await cacheNeedsRefresh(infoPath);
  if (imageRefresh || infoRefresh) {
    try {
      await Promise.all([
        imageRefresh ? fetchToFile(`${RADAR_SOURCE}/images/radars/${map}_radar_psd.png`, imagePath, true) : Promise.resolve(),
        infoRefresh ? fetchToFile(`${RADAR_SOURCE}/data/radar_info/${map}.txt`, infoPath, false) : Promise.resolve()
      ]);
    } catch (error) {
      if (!fs.existsSync(imagePath) || !fs.existsSync(infoPath)) throw error;
    }
  }
  const [image, overviewText] = await Promise.all([fs.promises.readFile(imagePath), fs.promises.readFile(infoPath, 'utf8')]);
  return { map, dataUrl: `data:image/png;base64,${image.toString('base64')}`, overview: parseOverviewText(overviewText), source: 'CS2 radar cache' };
}

function execFileAsync(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr || stdout || ''}`.trim();
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function expandZip(zip, destination) {
  await fs.promises.mkdir(destination, { recursive: true });
  const escapedZip = zip.replace(/'/g, "''");
  const escapedDestination = destination.replace(/'/g, "''");
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDestination}' -Force`], { timeout: 180000 });
}

async function findRecursive(root, predicate) {
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (predicate(full, entry.name)) return full;
    }
  }
  return null;
}

async function listRecursive(root, predicate) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (predicate(full, entry.name)) out.push(full);
    }
  }
  return out;
}

async function ensureTool({ name, version, url, sha256, exeName }) {
  const root = path.join(app.getPath('userData'), 'tools', `${name}-${version}`);
  const existing = await findRecursive(root, (_full, fileName) => fileName.toLowerCase() === exeName.toLowerCase());
  if (existing) return existing;
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.mkdir(root, { recursive: true });
  const zip = path.join(root, 'tool.zip');
  await fetchToFile(url, zip, true);
  const digest = await sha256File(zip);
  if (digest.toLowerCase() !== sha256.toLowerCase()) {
    await fs.promises.rm(root, { recursive: true, force: true });
    throw new Error(`${name} indirmesi SHA-256 doğrulamasından geçmedi.`);
  }
  const unpacked = path.join(root, 'bin');
  await expandZip(zip, unpacked);
  const exe = await findRecursive(unpacked, (_full, fileName) => fileName.toLowerCase() === exeName.toLowerCase());
  if (!exe) throw new Error(`${name}: ${exeName} arşiv içinde bulunamadı.`);
  return exe;
}

function registerServedFile(file, contentType = 'application/octet-stream') {
  const token = crypto.randomUUID();
  servedFiles.set(token, { file, contentType });
  return `matchframe://asset/${token}/${encodeURIComponent(path.basename(file))}`;
}

async function prepareOfflinePov(mapName) {
  const map = String(mapName || '').toLowerCase();
  if (!/^[a-z0-9_]+$/.test(map)) throw new Error('Geçersiz map adı.');
  if (povJobs.has(map)) return povJobs.get(map);
  const job = (async () => {
    const gameRoot = findCs2GameRoot();
    if (!gameRoot) throw new Error('Yerel CS2 kurulumu bulunamadı. Offline POV map dosyalarını yerel kurulumdan okur.');
    const mapVpk = path.join(gameRoot, 'maps', `${map}.vpk`);
    if (!fs.existsSync(mapVpk)) throw new Error(`${map}.vpk yerel CS2 kurulumunda bulunamadı.`);
    const gameInfo = path.join(gameRoot, 'gameinfo.gi');
    const cacheRoot = path.join(app.getPath('userData'), 'offline-pov', map);
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    // Versioned cache filename intentionally invalidates old GLBs that were exported without
    // glTF texture adaptation and could render as an all-black scene.
    const cachedGlb = path.join(cacheRoot, `${map}.${POV_CACHE_VERSION}.glb`);
    let validCache = false;
    try {
      const [glbStat, vpkStat] = await Promise.all([fs.promises.stat(cachedGlb), fs.promises.stat(mapVpk)]);
      validCache = glbStat.size > 256 * 1024 && glbStat.mtimeMs >= vpkStat.mtimeMs;
    } catch (_) {}

    if (!validCache) {
      const cli = await ensureTool({ name: 'source2viewer', version: VRF_VERSION, url: VRF_URL, sha256: VRF_SHA256, exeName: 'Source2Viewer-CLI.exe' });
      const exportDir = path.join(cacheRoot, `export-${POV_CACHE_VERSION}`);
      await fs.promises.rm(exportDir, { recursive: true, force: true });
      await fs.promises.mkdir(exportDir, { recursive: true });
      const internal = `maps/${map}.vmap_c`;
      let exported = null;
      try {
        await execFileAsync(cli, [
          '-i', mapVpk,
          '-o', exportDir,
          '-d',
          '--vpk_filepath', internal,
          '--gltf_export_format', 'glb',
          '--gltf_export_materials',
          '--gltf_textures_adapt',
          '--game', gameInfo
        ], { timeout: 15 * 60 * 1000 });
        const glbs = await listRecursive(exportDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
        if (glbs.length) {
          const stats = await Promise.all(glbs.map(async (file) => ({ file, size: (await fs.promises.stat(file)).size })));
          exported = stats.sort((a, b) => b.size - a.size)[0].file;
        }
      } catch (_) {}

      if (!exported) {
        const rawDir = path.join(cacheRoot, `raw-${POV_CACHE_VERSION}`);
        await fs.promises.rm(rawDir, { recursive: true, force: true });
        await fs.promises.mkdir(rawDir, { recursive: true });
        await execFileAsync(cli, ['-i', mapVpk, '-o', rawDir, '--vpk_filepath', internal], { timeout: 5 * 60 * 1000 });
        const compiled = await findRecursive(rawDir, (_full, name) => name.toLowerCase() === `${map}.vmap_c`);
        if (!compiled) throw new Error('Source 2 map resource VPK içinden çıkarılamadı.');
        await execFileAsync(cli, [
          '-i', compiled,
          '-o', cachedGlb,
          '-d',
          '--gltf_export_format', 'glb',
          '--gltf_export_materials',
          '--gltf_textures_adapt',
          '--game', gameInfo
        ], { timeout: 15 * 60 * 1000 });
        exported = cachedGlb;
      }
      if (exported !== cachedGlb) await fs.promises.copyFile(exported, cachedGlb);
      const exportedStat = await fs.promises.stat(cachedGlb);
      if (exportedStat.size <= 256 * 1024) {
        await fs.promises.rm(cachedGlb, { force: true });
        throw new Error('POV GLB exportu eksik görünüyor; cache oluşturulmadı.');
      }
    }

    return {
      ok: true,
      map,
      url: registerServedFile(cachedGlb, 'model/gltf-binary'),
      sourceScale: 0.0254,
      renderer: `Source 2 Viewer ${VRF_VERSION} export`,
      cacheVersion: POV_CACHE_VERSION,
      cs2RunningRequired: false
    };
  })();
  povJobs.set(map, job);
  try { return await job; } finally { povJobs.delete(map); }
}

async function demoCacheKey(file) {
  const stat = await fs.promises.stat(file);
  return crypto.createHash('sha1').update(`${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`).digest('hex');
}

async function prepareVoice(file) {
  const key = await demoCacheKey(file);
  if (voiceJobs.has(key)) return voiceJobs.get(key);
  const job = (async () => {
    const output = path.join(app.getPath('userData'), 'voice', key);
    const manifestPath = path.join(output, 'manifest.json');
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      const tracks = (manifest.tracks || []).filter((track) => fs.existsSync(track.file));
      if (tracks.length) return { available: true, tracks: tracks.map((track) => ({ steamid: track.steamid, url: registerServedFile(track.file, 'audio/wav') })) };
      if (manifest.complete) return { available: false, tracks: [] };
    } catch (_) {}

    await fs.promises.rm(output, { recursive: true, force: true });
    await fs.promises.mkdir(output, { recursive: true });
    const extractor = await ensureTool({ name: 'cs2-voice-extractor', version: VOICE_TOOL_VERSION, url: VOICE_TOOL_URL, sha256: VOICE_TOOL_SHA256, exeName: 'csgove.exe' });
    try {
      await execFileAsync(extractor, ['-mode', 'split-full', '-output', output, file], { timeout: 15 * 60 * 1000, cwd: path.dirname(extractor) });
    } catch (error) {
      const message = String(error.message || error);
      if (!/no voice|voice data|nothing to extract/i.test(message)) throw error;
    }
    const wavs = await listRecursive(output, (_full, name) => name.toLowerCase().endsWith('.wav'));
    const tracks = [];
    for (const wav of wavs) {
      const match = path.basename(wav).match(/(7656\d{13})/);
      if (!match) continue;
      tracks.push({ steamid: match[1], file: wav });
    }
    await fs.promises.writeFile(manifestPath, JSON.stringify({ complete: true, tracks }, null, 2));
    return { available: tracks.length > 0, tracks: tracks.map((track) => ({ steamid: track.steamid, url: registerServedFile(track.file, 'audio/wav') })) };
  })();
  voiceJobs.set(key, job);
  try { return await job; } finally { voiceJobs.delete(key); }
}

app.whenReady().then(() => {
  protocol.handle('matchframe', async (request) => {
    try {
      const url = new URL(request.url);
      const token = url.pathname.split('/').filter(Boolean)[0];
      const item = servedFiles.get(token);
      if (!item || !fs.existsSync(item.file)) return new Response('Not found', { status: 404 });
      const fileResponse = await net.fetch(pathToFileURL(item.file).href);
      if (fileResponse.ok) return fileResponse;
      const bytes = await fs.promises.readFile(item.file);
      return new Response(bytes, { headers: { 'Content-Type': item.contentType } });
    } catch (error) {
      return new Response(String(error.message || error), { status: 500 });
    }
  });
  startCore();
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (core && !core.killed) core.kill(); });

ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window:close', () => mainWindow.close());

ipcMain.handle('demo:open', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Counter-Strike 2 Demo', extensions: ['dem'] }] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const file = result.filePaths[0];
  const sendProgress = (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('demo:progress', progress);
  };
  sendProgress({ percent: 0, stage: 'Demo dosyası seçildi. Parser başlatılıyor…' });
  const data = await parseDemo(file, sendProgress);
  return { canceled: false, file, ...data };
});
ipcMain.handle('radar:load', async (_event, mapName) => loadRadarAsset(mapName));
ipcMain.handle('pov:prepare', async (_event, mapName) => prepareOfflinePov(mapName));
ipcMain.handle('voice:prepare', async (_event, file) => prepareVoice(file));
ipcMain.handle('core:status', async () => coreRequest('backend_info'));
ipcMain.handle('core:command', async (_event, command) => coreRequest('console', { command }));
ipcMain.handle('core:request', async (_event, action, payload) => coreRequest(action, payload));
