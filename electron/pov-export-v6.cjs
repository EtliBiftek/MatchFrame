const { app, net } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const CACHE_VERSION = 'v9';
const MIN_GLB_SIZE = 256 * 1024;
const JSON_CHUNK = 0x4e4f534a;
const COPY_BUFFER_SIZE = 8 * 1024 * 1024;
const jobs = new Map();
const served = new Map();

function execFileAsync(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = Number(options.timeout || 300000);
    const child = execFile(exe, args, {
      windowsHide: true,
      shell: false,
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
      env: { ...process.env, DOTNET_NOLOGO: '1' },
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || '').trim();
        error.message = `${error.message}${details ? `\n${details}` : ''}`;
        reject(error);
      } else resolve({ stdout, stderr });
    });
    const treeTimer = setTimeout(() => {
      if (child.pid && child.exitCode === null) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    }, timeout + 1500);
    child.once('exit', () => clearTimeout(treeTimer));
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
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, Buffer.from(await response.arrayBuffer()));
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

async function ensureVrf() {
  const root = path.join(app.getPath('userData'), 'tools', `source2viewer-${VRF_VERSION}`);
  const existing = await findRecursive(root, (_full, name) => name.toLowerCase() === 'source2viewer-cli.exe');
  if (existing) return existing;
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.mkdir(root, { recursive: true });
  const zip = path.join(root, 'tool.zip');
  await fetchToFile(VRF_URL, zip);
  if ((await sha256File(zip)).toLowerCase() !== VRF_SHA256.toLowerCase()) throw new Error('Source 2 Viewer indirmesi SHA-256 doğrulamasından geçmedi.');
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

async function readExact(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesRead) throw new Error('GLB beklenmedik şekilde sona erdi.');
    offset += bytesRead;
  }
}

async function writeExact(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesWritten) throw new Error('GLB hedef dosyasına yazılamadı.');
    offset += bytesWritten;
  }
}

async function readGlbStructure(file) {
  const stat = await fs.promises.stat(file);
  if (stat.size < 20) throw new Error('GLB dosyası çok küçük.');
  const handle = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.allocUnsafe(12);
    await readExact(handle, header, 0);
    if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2) throw new Error('Geçersiz glTF 2.0 GLB.');
    const declaredLength = header.readUInt32LE(8);
    if (declaredLength > stat.size || declaredLength < 20) throw new Error('GLB uzunluğu geçersiz.');
    const chunks = [];
    let position = 12;
    let jsonChunk = null;
    while (position + 8 <= declaredLength) {
      const chunkHeader = Buffer.allocUnsafe(8);
      await readExact(handle, chunkHeader, position);
      const length = chunkHeader.readUInt32LE(0);
      const type = chunkHeader.readUInt32LE(4);
      const dataOffset = position + 8;
      if (dataOffset + length > declaredLength) throw new Error('GLB chunk sınırları bozuk.');
      const chunk = { type, length, dataOffset };
      chunks.push(chunk);
      if (type === JSON_CHUNK && !jsonChunk) jsonChunk = chunk;
      position = dataOffset + length;
    }
    if (!jsonChunk) throw new Error('GLB JSON chunk bulunamadı.');
    const jsonBuffer = Buffer.allocUnsafe(jsonChunk.length);
    await readExact(handle, jsonBuffer, jsonChunk.dataOffset);
    const gltf = JSON.parse(jsonBuffer.toString('utf8').replace(/[\u0000\s]+$/g, ''));
    return { stat, chunks, jsonChunk, gltf };
  } finally {
    await handle.close();
  }
}

async function isSafeGlb(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size < MIN_GLB_SIZE) return false;
    const { gltf } = await readGlbStructure(file);
    const hasGeometry = Array.isArray(gltf.meshes) && gltf.meshes.some((mesh) => Array.isArray(mesh.primitives) && mesh.primitives.length);
    const hasImages = Array.isArray(gltf.images) || Array.isArray(gltf.textures);
    return hasGeometry && !hasImages && gltf.asset?.extras?.matchframeSafeColor === true;
  } catch (_) { return false; }
}

function palette(name, index) {
  const key = String(name || '').toLowerCase();
  const rules = [
    [/(brick|roof|tile|clay|terracotta)/, [0.58,0.30,0.20,1]],
    [/(wood|door|crate|barrel)/, [0.38,0.27,0.17,1]],
    [/(grass|leaf|foliage|tree|plant|vine)/, [0.22,0.36,0.20,1]],
    [/(road|street|asphalt|pavement)/, [0.25,0.26,0.28,1]],
    [/(metal|pipe|rail|steel|iron|grate)/, [0.31,0.35,0.38,1]],
    [/(glass|window)/, [0.39,0.54,0.62,1]],
    [/(sand|dirt|soil|earth)/, [0.48,0.39,0.27,1]],
    [/(stone|wall|plaster|stucco|concrete)/, [0.61,0.57,0.49,1]]
  ];
  for (const [re, color] of rules) if (re.test(key)) return color;
  const fallback = [[0.58,0.50,0.39,1],[0.45,0.40,0.34,1],[0.64,0.58,0.47,1],[0.40,0.43,0.41,1],[0.52,0.37,0.28,1],[0.38,0.41,0.46,1]];
  let hash = 2166136261;
  const text = key || `mesh-${index}`;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return fallback[(hash >>> 0) % fallback.length];
}

function sanitizeGeometryJson(gltf) {
  const oldMaterials = Array.isArray(gltf.materials) ? gltf.materials : [];
  delete gltf.images; delete gltf.textures; delete gltf.samplers;
  gltf.materials = [];
  const materialByColor = new Map();
  let primitiveIndex = 0;
  for (const mesh of gltf.meshes || []) {
    const meshName = mesh.name || `mesh-${primitiveIndex}`;
    for (const primitive of mesh.primitives || []) {
      if (primitive.attributes) {
        delete primitive.attributes.COLOR_0;
        delete primitive.attributes.TANGENT;
        delete primitive.attributes.TEXCOORD_0;
        delete primitive.attributes.TEXCOORD_1;
      }
      const oldMaterialName = Number.isInteger(primitive.material) ? oldMaterials[primitive.material]?.name : '';
      const color = palette(oldMaterialName || meshName, primitiveIndex);
      const key = color.join(',');
      if (!materialByColor.has(key)) {
        const index = gltf.materials.length;
        materialByColor.set(key, index);
        gltf.materials.push({ name: `mf-safe-${index}`, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'OPAQUE', doubleSided: true });
      }
      primitive.material = materialByColor.get(key);
      primitiveIndex++;
    }
  }
  gltf.asset = gltf.asset || { version: '2.0' };
  gltf.asset.extras = { ...(gltf.asset.extras || {}), matchframeSafeColor: true, cacheVersion: CACHE_VERSION };
  return gltf;
}

async function sanitizeGeometryGlbFile(source, destination) {
  const structure = await readGlbStructure(source);
  const gltf = sanitizeGeometryJson(structure.gltf);
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  if (pad) json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const totalLength = 12 + structure.chunks.reduce((sum, chunk) => sum + 8 + (chunk === structure.jsonChunk ? json.length : chunk.length), 0);
  const sourceHandle = await fs.promises.open(source, 'r');
  const destinationHandle = await fs.promises.open(destination, 'w');
  try {
    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLength, 8);
    await writeExact(destinationHandle, header, 0);
    let outPosition = 12;
    for (const chunk of structure.chunks) {
      const isJson = chunk === structure.jsonChunk;
      const dataLength = isJson ? json.length : chunk.length;
      const chunkHeader = Buffer.allocUnsafe(8);
      chunkHeader.writeUInt32LE(dataLength, 0); chunkHeader.writeUInt32LE(chunk.type, 4);
      await writeExact(destinationHandle, chunkHeader, outPosition); outPosition += 8;
      if (isJson) await writeExact(destinationHandle, json, outPosition);
      else {
        const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_SIZE, chunk.length));
        let copied = 0;
        while (copied < chunk.length) {
          const wanted = Math.min(buffer.length, chunk.length - copied);
          const { bytesRead } = await sourceHandle.read(buffer, 0, wanted, chunk.dataOffset + copied);
          if (!bytesRead) throw new Error('GLB kopyalanırken kaynak beklenmedik şekilde sona erdi.');
          await writeExact(destinationHandle, buffer.subarray(0, bytesRead), outPosition + copied); copied += bytesRead;
        }
      }
      outPosition += dataLength;
    }
  } finally { await Promise.allSettled([sourceHandle.close(), destinationHandle.close()]); }
}

async function exportMapGlb(cli, mapVpk, internal, gameInfo, outputDir, cacheRoot) {
  await fs.promises.rm(outputDir, { recursive: true, force: true });
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Source 2 Viewer map export writes a GLB into the output DIRECTORY, not to a file path.
  // The previous implementation incorrectly treated -o <file.glb> as a file destination.
  const args = ['-i', mapVpk, '-o', outputDir, '-d', '--vpk_filepath', internal, '--gltf_export_format', 'glb', '--threads', '1', '--game', gameInfo];
  let exportError = null;
  try { await execFileAsync(cli, args, { timeout: 20 * 60 * 1000 }); } catch (error) { exportError = error; }
  const directGlb = await findRecursive(outputDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
  if (directGlb) return directGlb;

  // Fallback: export the entire map VPK unchanged first. Maps have world-node/entity/
  // dependency files under maps/<map>/; extracting only the .vmap_c is insufficient.
  const rawDir = path.join(cacheRoot, `source-${CACHE_VERSION}`);
  await fs.promises.rm(rawDir, { recursive: true, force: true });
  await fs.promises.mkdir(rawDir, { recursive: true });
  let extractionError = null;
  try { await execFileAsync(cli, ['-i', mapVpk, '-o', rawDir], { timeout: 10 * 60 * 1000 }); } catch (error) { extractionError = error; }
  const compiled = await findRecursive(rawDir, (_full, name) => name.toLowerCase() === `${path.basename(mapVpk, '.vpk')}.vmap_c`);
  if (!compiled) {
    const detail = extractionError || exportError;
    throw new Error(`Map VPK içinden .vmap_c çıkarılamadı.${detail ? `\n${String(detail.message || detail).trim()}` : ''}`);
  }

  await fs.promises.rm(outputDir, { recursive: true, force: true });
  await fs.promises.mkdir(outputDir, { recursive: true });
  let standaloneError = null;
  try { await execFileAsync(cli, ['-i', compiled, '-o', outputDir, '-d', '--gltf_export_format', 'glb', '--threads', '1', '--game', gameInfo], { timeout: 20 * 60 * 1000, cwd: rawDir }); }
  catch (error) { standaloneError = error; }
  const fallbackGlb = await findRecursive(outputDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
  if (!fallbackGlb) throw new Error(`Map GLB çıktısı oluşturulamadı.${standaloneError ? `\n${String(standaloneError.message || standaloneError).trim()}` : ''}`);
  return fallbackGlb;
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
    const gameInfo = path.join(gameRoot, 'gameinfo.gi');
    const cacheRoot = path.join(app.getPath('userData'), 'offline-pov', map);
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    const cachedGlb = path.join(cacheRoot, `${map}.${CACHE_VERSION}.glb`);
    if (!(await isSafeGlb(cachedGlb))) {
      const cli = await ensureVrf();
      const outputDir = path.join(cacheRoot, `export-${CACHE_VERSION}`);
      const rawGlb = await exportMapGlb(cli, mapVpk, `maps/${map}.vmap_c`, gameInfo, outputDir, cacheRoot);
      const temp = `${cachedGlb}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.rm(temp, { force: true });
      await sanitizeGeometryGlbFile(rawGlb, temp);
      await fs.promises.rm(cachedGlb, { force: true });
      await fs.promises.rename(temp, cachedGlb);
    }
    if (!(await isSafeGlb(cachedGlb))) throw new Error('POV cache oluşturuldu fakat GLB doğrulamasından geçemedi.');
    return { ok: true, map, url: registerAsset(cachedGlb), sourceScale: 0.0254, renderer: `Source 2 Viewer ${VRF_VERSION} map VPK → glTF GLB / safe-colour conversion`, cacheVersion: CACHE_VERSION, cs2RunningRequired: false };
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
      return new Response(await fs.promises.readFile(file), { headers: { 'Content-Type': 'model/gltf-binary' } });
    } catch (error) { return new Response(String(error?.message || error), { status: 500 }); }
  });
}

module.exports = { prepare, installProtocol, cacheVersion: CACHE_VERSION };
