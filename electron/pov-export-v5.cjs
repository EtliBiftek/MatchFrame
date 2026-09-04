const { app, net } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const CACHE_VERSION = 'v5';
const jobs = new Map();
const served = new Map();

function execFileAsync(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180000,
      killSignal: 'SIGKILL',
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || '').trim();
        error.message = `${error.message}${details ? `\n${details}` : ''}`;
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
  return normal[0]?.file || stats.sort((a, b) => b.size - a.size)[0]?.file || null;
}

function palette(name, index) {
  const key = String(name || '').toLowerCase();
  const rules = [
    [/(brick|roof|tile|clay|terracotta)/, [0.58, 0.30, 0.20, 1]],
    [/(wood|door|crate|barrel)/, [0.38, 0.27, 0.17, 1]],
    [/(grass|leaf|foliage|tree|plant|vine)/, [0.22, 0.36, 0.20, 1]],
    [/(road|street|asphalt|pavement)/, [0.25, 0.26, 0.28, 1]],
    [/(metal|pipe|rail|steel|iron|grate)/, [0.31, 0.35, 0.38, 1]],
    [/(glass|window)/, [0.39, 0.54, 0.62, 1]],
    [/(sand|dirt|soil|earth)/, [0.48, 0.39, 0.27, 1]],
    [/(stone|wall|plaster|stucco|concrete)/, [0.61, 0.57, 0.49, 1]]
  ];
  for (const [re, c] of rules) if (re.test(key)) return c;
  const fallback = [[0.58,0.50,0.39,1],[0.45,0.40,0.34,1],[0.64,0.58,0.47,1],[0.40,0.43,0.41,1],[0.52,0.37,0.28,1],[0.38,0.41,0.46,1]];
  return fallback[index % fallback.length];
}

function sanitizeGeometryGlb(input) {
  if (!Buffer.isBuffer(input) || input.length < 20 || input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) {
    throw new Error('Geçersiz glTF 2.0 GLB.');
  }
  const chunks = [];
  let offset = 12;
  let jsonIndex = -1;
  while (offset + 8 <= input.length) {
    const len = input.readUInt32LE(offset);
    const type = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + len;
    if (end > input.length) throw new Error('GLB chunk sınırları bozuk.');
    chunks.push({ type, data: Buffer.from(input.subarray(start, end)) });
    if (type === 0x4e4f534a) jsonIndex = chunks.length - 1;
    offset = end;
  }
  if (jsonIndex < 0) throw new Error('GLB JSON chunk bulunamadı.');
  const gltf = JSON.parse(chunks[jsonIndex].data.toString('utf8').replace(/[\u0000\s]+$/g, ''));

  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  gltf.materials = [];

  let materialIndex = 0;
  for (const mesh of gltf.meshes || []) {
    const meshName = mesh.name || `mesh-${materialIndex}`;
    for (const primitive of mesh.primitives || []) {
      if (primitive.attributes) delete primitive.attributes.COLOR_0;
      const color = palette(meshName, materialIndex);
      primitive.material = gltf.materials.length;
      gltf.materials.push({
        name: `mf-${meshName}-${materialIndex}`,
        pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 1 },
        alphaMode: 'OPAQUE',
        doubleSided: true
      });
      materialIndex++;
    }
  }

  gltf.extensionsUsed = (gltf.extensionsUsed || []).filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
  gltf.extensionsRequired = (gltf.extensionsRequired || []).filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
  if (!gltf.extensionsUsed.length) delete gltf.extensionsUsed;
  if (!gltf.extensionsRequired.length) delete gltf.extensionsRequired;
  gltf.asset = gltf.asset || { version: '2.0' };
  gltf.asset.extras = { ...(gltf.asset.extras || {}), matchframeSafeColor: true, cacheVersion: CACHE_VERSION };

  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  if (pad) json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  chunks[jsonIndex].data = json;

  const total = 12 + chunks.reduce((sum, c) => sum + 8 + c.data.length, 0);
  const output = Buffer.allocUnsafe(total);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(total, 8);
  let out = 12;
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.data.length, out);
    output.writeUInt32LE(chunk.type, out + 4);
    chunk.data.copy(output, out + 8);
    out += 8 + chunk.data.length;
  }
  return output;
}

async function fileIsFresh(file, source) {
  try {
    const [a, b] = await Promise.all([fs.promises.stat(file), fs.promises.stat(source)]);
    return a.size > 256 * 1024 && a.mtimeMs >= b.mtimeMs;
  } catch (_) { return false; }
}

function registerAsset(file) {
  const token = crypto.randomUUID();
  served.set(token, file);
  return `matchframe-pov://asset/${token}/${encodeURIComponent(path.basename(file))}`;
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
    const cacheRoot = path.join(app.getPath('userData'), 'offline-pov', map);
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    const cachedGlb = path.join(cacheRoot, `${map}.${CACHE_VERSION}.glb`);

    if (!(await fileIsFresh(cachedGlb, mapVpk))) {
      const cli = await ensureVrf();
      const exportDir = path.join(cacheRoot, `export-${CACHE_VERSION}`);
      await fs.promises.rm(exportDir, { recursive: true, force: true });
      await fs.promises.mkdir(exportDir, { recursive: true });
      const internal = `maps/${map}.vmap_c`;

      // Critical: do NOT export Source 2 materials/textures here. That path can stall in
      // Source2Viewer and is wasted work because MatchFrame uses its own safe colours anyway.
      await execFileAsync(cli, [
        '-i', mapVpk,
        '-o', exportDir,
        '-d',
        '--vpk_filepath', internal,
        '--gltf_export_format', 'glb',
        '--threads', '1'
      ], { timeout: 180000 });

      const glbs = await listRecursive(exportDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
      const chosen = await chooseExport(glbs, map);
      if (!chosen) throw new Error('Haritanın GLB çıktısı bulunamadı.');
      const safe = sanitizeGeometryGlb(await fs.promises.readFile(chosen));
      await fs.promises.writeFile(cachedGlb, safe);
      const stat = await fs.promises.stat(cachedGlb);
      if (stat.size <= 256 * 1024) throw new Error('POV GLB çıktısı eksik görünüyor.');
    }

    return {
      ok: true,
      map,
      url: registerAsset(cachedGlb),
      sourceScale: 0.0254,
      renderer: `Source 2 Viewer ${VRF_VERSION} geometry-only safe-colour export`,
      cacheVersion: CACHE_VERSION,
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
      const response = await net.fetch(pathToFileURL(file).href);
      if (response.ok) return response;
      const bytes = await fs.promises.readFile(file);
      return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' } });
    } catch (error) {
      return new Response(String(error?.message || error), { status: 500 });
    }
  });
}

module.exports = { prepare, installProtocol, cacheVersion: CACHE_VERSION };
