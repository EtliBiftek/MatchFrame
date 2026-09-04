const { app, BrowserWindow, dialog, ipcMain, desktopCapturer, session, net } = require('electron');
const { Worker } = require('node:worker_threads');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

let mainWindow;
let core;
let nextRequestId = 1;
const pending = new Map();
const RADAR_SOURCE = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main';
const RADAR_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

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

function parseDemo(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'demo-worker.cjs'));
    worker.once('message', (message) => {
      worker.terminate();
      message.ok ? resolve(message.data) : reject(new Error(message.error));
    });
    worker.once('error', reject);
    worker.postMessage({ file });
  });
}

function steamCandidates() {
  const pf86 = process.env['ProgramFiles(x86)'];
  const pf = process.env.ProgramFiles;
  return [
    pf86 && path.join(pf86, 'Steam', 'steam.exe'),
    pf && path.join(pf, 'Steam', 'steam.exe'),
    'C:\\Program Files (x86)\\Steam\\steam.exe'
  ].filter(Boolean);
}

async function launchDemo(file) {
  const steam = steamCandidates().find(fs.existsSync);
  if (!steam) throw new Error('Steam.exe bulunamadı.');
  execFile(steam, ['-applaunch', '730', '+playdemo', file], { windowsHide: false });
  return true;
}

async function findCs2CaptureSource() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });
  return sources.find((source) => /counter[- ]?strike\s*2|\bcs2\b/i.test(source.name)) || null;
}

function configureDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const source = await findCs2CaptureSource();
      if (!source) return callback({});
      callback({ video: source });
    } catch (_) {
      callback({});
    }
  });
}

function parseOverviewText(text) {
  const number = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s+"?(-?[0-9.]+)"?`, 'i'));
    return match ? Number(match[1]) : null;
  };
  const posX = number('pos_x');
  const posY = number('pos_y');
  const scale = number('scale');
  if (![posX, posY, scale].every(Number.isFinite) || scale <= 0) {
    throw new Error('Radar overview koordinatları okunamadı.');
  }
  return {
    posX,
    posY,
    scale,
    rotate: number('rotate') || 0,
    zoom: number('zoom') || 1
  };
}

async function cacheNeedsRefresh(file) {
  try {
    const stat = await fs.promises.stat(file);
    return Date.now() - stat.mtimeMs > RADAR_CACHE_MAX_AGE;
  } catch (_) {
    return true;
  }
}

async function fetchToFile(url, file, binary) {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Radar asset HTTP ${response.status}`);
  const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  await fs.promises.writeFile(file, data);
}

async function loadRadarAsset(mapName) {
  const map = String(mapName || '').trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(map)) throw new Error('Geçersiz map adı.');

  const cacheDir = path.join(app.getPath('userData'), 'radars');
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const imagePath = path.join(cacheDir, `${map}_radar_psd.png`);
  const infoPath = path.join(cacheDir, `${map}.txt`);
  const imageUrl = `${RADAR_SOURCE}/images/radars/${map}_radar_psd.png`;
  const infoUrl = `${RADAR_SOURCE}/data/radar_info/${map}.txt`;

  const imageRefresh = await cacheNeedsRefresh(imagePath);
  const infoRefresh = await cacheNeedsRefresh(infoPath);
  if (imageRefresh || infoRefresh) {
    try {
      await Promise.all([
        imageRefresh ? fetchToFile(imageUrl, imagePath, true) : Promise.resolve(),
        infoRefresh ? fetchToFile(infoUrl, infoPath, false) : Promise.resolve()
      ]);
    } catch (error) {
      if (!fs.existsSync(imagePath) || !fs.existsSync(infoPath)) throw error;
    }
  }

  const [image, overviewText] = await Promise.all([
    fs.promises.readFile(imagePath),
    fs.promises.readFile(infoPath, 'utf8')
  ]);
  return {
    map,
    dataUrl: `data:image/png;base64,${image.toString('base64')}`,
    overview: parseOverviewText(overviewText),
    source: 'Valve CS2 radar cache'
  };
}

app.whenReady().then(() => {
  configureDisplayCapture();
  startCore();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (core && !core.killed) core.kill();
});

ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window:close', () => mainWindow.close());

ipcMain.handle('demo:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Counter-Strike 2 Demo', extensions: ['dem'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const file = result.filePaths[0];
  const data = await parseDemo(file);
  return { canceled: false, file, ...data };
});

ipcMain.handle('demo:launch', async (_event, file) => {
  await launchDemo(file);
  return { ok: true };
});

ipcMain.handle('capture:status', async () => {
  const source = await findCs2CaptureSource();
  return { available: Boolean(source), name: source?.name || null };
});

ipcMain.handle('radar:load', async (_event, mapName) => loadRadarAsset(mapName));
ipcMain.handle('core:status', async () => coreRequest('backend_info'));
ipcMain.handle('core:command', async (_event, command) => coreRequest('console', { command }));
ipcMain.handle('core:request', async (_event, action, payload) => coreRequest(action, payload));
