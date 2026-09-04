const { app, net } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const POV_CACHE_VERSION = 'v3';
const jobs = new Map();
const served = new Map();

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

async function fetchToFile(url, file) {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, data);
}

async function expandZip(zip, destination) {
  await fs.promises.mkdir(destination, { recursive: true });
  const z = zip.replace(/'/g, "''");
  const d = destination.replace(/'/g, "''");
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${z}' -DestinationPath '${d}' -Force`], { timeout: 180000 });
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

async function ensureVrf() {
  const root = path.join(app.getPath('userData'), 'tools', `source2viewer-${VRF_VERSION}`);
  const existing = await findRecursive(root, (_full, name) => name.toLowerCase() === 'source2viewer-cli.exe');
  if (existing) return existing;
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.mkdir(root, { recursive: true });
  const zip = path.join(root, 'tool.zip');
  await fetchToFile(VRF_URL, zip);
  const digest = await sha256File(zip);
  if (digest.toLowerCase() !== VRF_SHA256.toLowerCase()) {
    await fs.promises.rm(root, { recursive: true, force: true });
    throw new Error('Source 2 Viewer indirmesi SHA-256 doğrulamasından geçmedi.');
  }
  const unpacked = path.join(root, 'bin');
  await expandZip(zip, unpacked);
  const exe = await findRecursive(unpacked, (_full, name) => name.toLowerCase() === 'source2viewer-cli.exe');
  if (!exe) throw new Error('Source2Viewer-CLI.exe bulunamadı.');
  return exe;
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
    try {
      const text = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(match[1].replace(/\\\\/g, '\\'));
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

function badVariant(file) {
  return /(?:wingman|2v2|_wm(?:\.|_|$)|short|duo)/i.test(file.replace(/\\/g, '/'));
}

async function chooseExport(glbs, map) {
  const stats = await Promise.all(glbs.map(async (file) => ({
    file,
    base: path.basename(file).toLowerCase(),
    rel: file.replace(/\\/g, '/').toLowerCase(),
    size: (await fs.promises.stat(file)).size
  })));
  const exactName = `${map.toLowerCase()}.glb`;
  const exact = stats.filter((x) => x.base === exactName && !badVariant(x.rel)).sort((a, b) => b.size - a.size);
  if (exact.length) return exact[0].file;
  const named = stats.filter((x) => x.base.startsWith(map.toLowerCase()) && !badVariant(x.rel)).sort((a, b) => b.size - a.size);
  if (named.length) return named[0].file;
  const normal = stats.filter((x) => !badVariant(x.rel)).sort((a, b) => b.size - a.size);
  if (normal.length) return normal[0].file;
  return stats.sort((a, b) => b.size - a.size)[0]?.file || null;
}

function registerAsset(file) {
  const token = crypto.randomUUID();
  served.set(token, file);
  return { token, url: `matchframe-pov://asset/${token}/${encodeURIComponent(path.basename(file))}` };
}

async function prepare(mapName) {
  const map = String(mapName || '').trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(map)) throw new Error('Geçersiz map adı.');
  if (jobs.has(map)) return jobs.get(map);
  const job = (async () => {
    const gameRoot = findCs2GameRoot();
    if (!gameRoot) throw new Error('Yerel CS2 kurulumu bulunamadı.');
    const mapVpk = path.join(gameRoot, 'maps', `${map}.vpk`);
    if (!fs.existsSync(mapVpk)) throw new Error(`${map}.vpk bulunamadı.`);
    const gameInfo = path.join(gameRoot, 'gameinfo.gi');
    const cacheRoot = path.join(app.getPath('userData'), 'offline-pov', map);
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    const cachedGlb = path.join(cacheRoot, `${map}.${POV_CACHE_VERSION}.glb`);
    let valid = false;
    try {
      const [glbStat, vpkStat] = await Promise.all([fs.promises.stat(cachedGlb), fs.promises.stat(mapVpk)]);
      valid = glbStat.size > 256 * 1024 && glbStat.mtimeMs >= vpkStat.mtimeMs;
    } catch (_) {}

    if (!valid) {
      const cli = await ensureVrf();
      const exportDir = path.join(cacheRoot, `export-${POV_CACHE_VERSION}`);
      await fs.promises.rm(exportDir, { recursive: true, force: true });
      await fs.promises.mkdir(exportDir, { recursive: true });
      const internal = `maps/${map}.vmap_c`;
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
      const chosen = await chooseExport(glbs, map);
      if (!chosen) throw new Error('Haritanın GLB çıktısı bulunamadı.');
      await fs.promises.copyFile(chosen, cachedGlb);
      const stat = await fs.promises.stat(cachedGlb);
      if (stat.size <= 256 * 1024) throw new Error('Harita GLB çıktısı eksik görünüyor.');
    }

    const asset = registerAsset(cachedGlb);
    return {
      ok: true,
      map,
      url: asset.url,
      sourceScale: 0.0254,
      renderer: `Source 2 Viewer ${VRF_VERSION} exact-map export`,
      cacheVersion: POV_CACHE_VERSION,
      cs2RunningRequired: false
    };
  })();
  jobs.set(map, job);
  try { return await job; } finally { jobs.delete(map); }
}

function installProtocol(protocol) {
  protocol.handle('matchframe-pov', async (request) => {
    try {
      const url = new URL(request.url);
      const token = url.pathname.split('/').filter(Boolean)[0];
      const file = served.get(token);
      if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
      const bytes = await fs.promises.readFile(file);
      return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary' } });
    } catch (error) {
      return new Response(String(error?.message || error), { status: 500 });
    }
  });
}

module.exports = { prepare, installProtocol, cacheVersion: POV_CACHE_VERSION };
