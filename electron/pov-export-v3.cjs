const { app, net } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const POV_CACHE_VERSION = 'v4';
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

function paletteForMaterial(name, index) {
  const key = String(name || '').toLowerCase();
  const rules = [
    [/(brick|terracotta|clay|roof|tile)/, [0.55, 0.28, 0.17, 1]],
    [/(wood|timber|door|crate|barrel)/, [0.36, 0.24, 0.14, 1]],
    [/(grass|leaf|foliage|tree|plant|vine)/, [0.18, 0.31, 0.17, 1]],
    [/(sand|dirt|soil|earth|ground)/, [0.47, 0.38, 0.25, 1]],
    [/(asphalt|road|street|pavement)/, [0.22, 0.23, 0.24, 1]],
    [/(metal|pipe|rail|steel|iron|grate)/, [0.28, 0.31, 0.33, 1]],
    [/(glass|window)/, [0.38, 0.52, 0.59, 1]],
    [/(plaster|stucco|concrete|stone|wall)/, [0.58, 0.54, 0.46, 1]],
    [/(paint.*red|red.*paint)/, [0.52, 0.18, 0.15, 1]],
    [/(paint.*blue|blue.*paint)/, [0.23, 0.34, 0.48, 1]]
  ];
  for (const [regex, color] of rules) if (regex.test(key)) return color;
  const palette = [
    [0.58, 0.50, 0.39, 1],
    [0.43, 0.39, 0.34, 1],
    [0.64, 0.57, 0.45, 1],
    [0.39, 0.42, 0.40, 1],
    [0.50, 0.35, 0.27, 1],
    [0.36, 0.39, 0.44, 1],
    [0.52, 0.47, 0.38, 1]
  ];
  let hash = 2166136261;
  const text = key || `material-${index}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return palette[(hash >>> 0) % palette.length];
}

function stripMaterialTextures(material, index) {
  if (!material || typeof material !== 'object') return;
  const pbr = material.pbrMetallicRoughness || (material.pbrMetallicRoughness = {});
  delete pbr.baseColorTexture;
  delete pbr.metallicRoughnessTexture;
  pbr.baseColorFactor = paletteForMaterial(material.name, index);
  pbr.metallicFactor = 0;
  pbr.roughnessFactor = 1;
  delete material.normalTexture;
  delete material.occlusionTexture;
  delete material.emissiveTexture;
  delete material.extensions;
  material.alphaMode = 'OPAQUE';
  material.doubleSided = true;
  material.emissiveFactor = [0, 0, 0];
}

function sanitizeGlbBuffer(input) {
  if (!Buffer.isBuffer(input) || input.length < 20) throw new Error('GLB dosyası geçersiz.');
  if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) throw new Error('Yalnızca glTF 2.0 GLB destekleniyor.');

  const chunks = [];
  let offset = 12;
  let jsonIndex = -1;
  while (offset + 8 <= input.length) {
    const length = input.readUInt32LE(offset);
    const type = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > input.length) throw new Error('GLB chunk sınırları bozuk.');
    chunks.push({ type, data: Buffer.from(input.subarray(start, end)) });
    if (type === 0x4e4f534a) jsonIndex = chunks.length - 1;
    offset = end;
  }
  if (jsonIndex < 0) throw new Error('GLB JSON chunk bulunamadı.');

  const jsonText = chunks[jsonIndex].data.toString('utf8').replace(/[\u0000\s]+$/g, '');
  const gltf = JSON.parse(jsonText);
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  if (Array.isArray(gltf.extensionsUsed)) {
    gltf.extensionsUsed = gltf.extensionsUsed.filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
    if (!gltf.extensionsUsed.length) delete gltf.extensionsUsed;
  }
  if (Array.isArray(gltf.extensionsRequired)) {
    gltf.extensionsRequired = gltf.extensionsRequired.filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
    if (!gltf.extensionsRequired.length) delete gltf.extensionsRequired;
  }
  for (let i = 0; i < (gltf.materials || []).length; i++) stripMaterialTextures(gltf.materials[i], i);
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (primitive.attributes) delete primitive.attributes.COLOR_0;
    }
  }
  gltf.asset = gltf.asset || { version: '2.0' };
  gltf.asset.extras = { ...(gltf.asset.extras || {}), matchframeSafeColor: true, cacheVersion: POV_CACHE_VERSION };

  let jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
  if (jsonPad) jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPad, 0x20)]);
  chunks[jsonIndex].data = jsonBuffer;

  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const output = Buffer.allocUnsafe(total);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(total, 8);
  let outOffset = 12;
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.data.length, outOffset);
    output.writeUInt32LE(chunk.type, outOffset + 4);
    chunk.data.copy(output, outOffset + 8);
    outOffset += 8 + chunk.data.length;
  }
  return output;
}

async function sanitizeGlb(source, destination) {
  const raw = await fs.promises.readFile(source);
  const safe = sanitizeGlbBuffer(raw);
  await fs.promises.writeFile(destination, safe);
}

function registerAsset(file) {
  const token = crypto.randomUUID();
  served.set(token, file);
  return { token, url: `matchframe-pov://asset/${token}/${encodeURIComponent(path.basename(file))}` };
}

async function fileIsFresh(file, source) {
  try {
    const [stat, sourceStat] = await Promise.all([fs.promises.stat(file), fs.promises.stat(source)]);
    return stat.size > 256 * 1024 && stat.mtimeMs >= sourceStat.mtimeMs;
  } catch (_) { return false; }
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

    if (!(await fileIsFresh(cachedGlb, mapVpk))) {
      let sourceGlb = path.join(cacheRoot, `${map}.v3.glb`);
      if (!(await fileIsFresh(sourceGlb, mapVpk))) {
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
        sourceGlb = await chooseExport(glbs, map);
        if (!sourceGlb) throw new Error('Haritanın GLB çıktısı bulunamadı.');
      }
      await sanitizeGlb(sourceGlb, cachedGlb);
      const stat = await fs.promises.stat(cachedGlb);
      if (stat.size <= 256 * 1024) {
        await fs.promises.rm(cachedGlb, { force: true });
        throw new Error('Güvenli POV GLB çıktısı eksik görünüyor.');
      }
    }

    const asset = registerAsset(cachedGlb);
    return {
      ok: true,
      map,
      url: asset.url,
      sourceScale: 0.0254,
      renderer: `Source 2 Viewer ${VRF_VERSION} safe-colour export`,
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
      const fileResponse = await net.fetch(pathToFileURL(file).href);
      if (fileResponse.ok) return fileResponse;
      const bytes = await fs.promises.readFile(file);
      return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' } });
    } catch (error) {
      return new Response(String(error?.message || error), { status: 500 });
    }
  });
}

module.exports = { prepare, installProtocol, cacheVersion: POV_CACHE_VERSION };
