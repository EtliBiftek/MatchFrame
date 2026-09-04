const { app, net } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const VRF_VERSION = '20.0';
const VRF_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/cli-windows-x64.zip`;
const VRF_SHA256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const CACHE_VERSION = 'v6';
const MIN_GLB_SIZE = 256 * 1024;
const COPY_BUFFER_SIZE = 8 * 1024 * 1024;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const jobs = new Map();
const served = new Map();

function execFileAsync(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = Number(options.timeout || 180000);
    const child = execFile(exe, args, {
      windowsHide: true,
      shell: false,
      maxBuffer: 32 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
      env: { ...process.env, DOTNET_NOLOGO: '1' },
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || '').trim();
        error.message = `${error.message}${details ? `\n${details}` : ''}`;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });

    const treeTimer = setTimeout(() => {
      if (!child.pid || child.exitCode !== null) return;
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
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
  const data = Buffer.from(await response.arrayBuffer());
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, data);
}

async function expandZip(zip, destination) {
  await fs.promises.mkdir(destination, { recursive: true });
  const z = zip.replace(/'/g, "''");
  const d = destination.replace(/'/g, "''");
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${z}' -DestinationPath '${d}' -Force`
  ], { timeout: 180000 });
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
  const fallback = [
    [0.58, 0.50, 0.39, 1], [0.45, 0.40, 0.34, 1], [0.64, 0.58, 0.47, 1],
    [0.40, 0.43, 0.41, 1], [0.52, 0.37, 0.28, 1], [0.38, 0.41, 0.46, 1]
  ];
  let hash = 2166136261;
  const text = key || `mesh-${index}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return fallback[(hash >>> 0) % fallback.length];
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
    const magic = header.readUInt32LE(0);
    const version = header.readUInt32LE(4);
    const declaredLength = header.readUInt32LE(8);
    if (magic !== 0x46546c67 || version !== 2) throw new Error('Geçersiz glTF 2.0 GLB.');
    if (declaredLength > stat.size || declaredLength < 20) throw new Error('GLB uzunluğu geçersiz.');

    const chunks = [];
    let position = 12;
    let jsonChunk = null;
    let binChunk = null;
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
      if (type === BIN_CHUNK && !binChunk) binChunk = chunk;
      position = dataOffset + length;
    }
    if (!jsonChunk) throw new Error('GLB JSON chunk bulunamadı.');
    if (jsonChunk.length > 128 * 1024 * 1024) throw new Error('GLB JSON chunk olağandışı büyük.');

    const jsonBuffer = Buffer.allocUnsafe(jsonChunk.length);
    await readExact(handle, jsonBuffer, jsonChunk.dataOffset);
    const jsonText = jsonBuffer.toString('utf8').replace(/[\u0000\s]+$/g, '');
    const gltf = JSON.parse(jsonText);
    return { stat, declaredLength, chunks, jsonChunk, binChunk, gltf };
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
    const hasTextureRefs = Array.isArray(gltf.images) || Array.isArray(gltf.textures);
    const markedSafe = Boolean(gltf.asset?.extras?.matchframeSafeColor);
    return hasGeometry && !hasTextureRefs && (markedSafe || Array.isArray(gltf.materials));
  } catch (_) {
    return false;
  }
}

async function isUsableRawGlb(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size < MIN_GLB_SIZE) return false;
    const { gltf } = await readGlbStructure(file);
    return Array.isArray(gltf.meshes) && gltf.meshes.some((mesh) => Array.isArray(mesh.primitives) && mesh.primitives.length);
  } catch (_) {
    return false;
  }
}

function collectBufferViewRefs(value, out, skipImages = false, keyName = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectBufferViewRefs(item, out, skipImages, keyName);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (skipImages && key === 'images') continue;
    if (key === 'bufferView' && Number.isInteger(child)) out.add(child);
    else collectBufferViewRefs(child, out, skipImages, key);
  }
}

function remapBufferViewRefs(value, mapping) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) remapBufferViewRefs(item, mapping);
    return;
  }
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (key === 'bufferView' && Number.isInteger(child)) {
      if (mapping.has(child)) value[key] = mapping.get(child);
      else delete value[key];
    } else {
      remapBufferViewRefs(child, mapping);
    }
  }
}

function sanitizeGeometryJson(gltf) {
  const oldMaterials = Array.isArray(gltf.materials) ? gltf.materials : [];
  const imageBufferViews = new Set();
  for (const image of gltf.images || []) {
    if (Number.isInteger(image?.bufferView)) imageBufferViews.add(image.bufferView);
  }
  const nonImageRefs = new Set();
  collectBufferViewRefs(gltf, nonImageRefs, true);
  const removableImageViews = new Set([...imageBufferViews].filter((index) => !nonImageRefs.has(index)));

  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
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
      const sourceName = oldMaterialName || meshName;
      const color = palette(sourceName, primitiveIndex);
      const colorKey = color.join(',');
      if (!materialByColor.has(colorKey)) {
        const index = gltf.materials.length;
        materialByColor.set(colorKey, index);
        gltf.materials.push({
          name: `mf-safe-${index}`,
          pbrMetallicRoughness: {
            baseColorFactor: color,
            metallicFactor: 0,
            roughnessFactor: 1
          },
          alphaMode: 'OPAQUE',
          doubleSided: true
        });
      }
      primitive.material = materialByColor.get(colorKey);
      primitiveIndex++;
    }
  }

  if (Array.isArray(gltf.extensionsUsed)) {
    gltf.extensionsUsed = gltf.extensionsUsed.filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
    if (!gltf.extensionsUsed.length) delete gltf.extensionsUsed;
  }
  if (Array.isArray(gltf.extensionsRequired)) {
    gltf.extensionsRequired = gltf.extensionsRequired.filter((x) => !/^KHR_(?:texture_transform|materials_)/i.test(String(x)));
    if (!gltf.extensionsRequired.length) delete gltf.extensionsRequired;
  }

  gltf.asset = gltf.asset || { version: '2.0' };
  gltf.asset.extras = {
    ...(gltf.asset.extras || {}),
    matchframeSafeColor: true,
    cacheVersion: CACHE_VERSION
  };
  return { gltf, removableImageViews };
}

function canCompactBin(gltf, structure, removableImageViews) {
  if (!structure.binChunk || !removableImageViews.size) return false;
  if (!Array.isArray(gltf.bufferViews) || !gltf.bufferViews.length) return false;
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1) return false;
  if (gltf.bufferViews.some((view) => Number(view?.buffer || 0) !== 0)) return false;
  if ((gltf.extensionsUsed || []).includes('EXT_meshopt_compression')) return false;
  if (gltf.bufferViews.some((view) => view?.extensions?.EXT_meshopt_compression)) return false;
  return true;
}

function buildBinCompaction(gltf, structure, removableImageViews) {
  if (!canCompactBin(gltf, structure, removableImageViews)) return null;

  const oldViews = gltf.bufferViews.map((view) => ({ ...view }));
  const mapping = new Map();
  const newViews = [];
  const copyPlan = [];
  let outputOffset = 0;

  for (let oldIndex = 0; oldIndex < oldViews.length; oldIndex++) {
    if (removableImageViews.has(oldIndex)) continue;
    const view = oldViews[oldIndex];
    const byteLength = Number(view.byteLength || 0);
    const sourceOffset = Number(view.byteOffset || 0);
    if (!Number.isFinite(byteLength) || byteLength < 0 || !Number.isFinite(sourceOffset) || sourceOffset < 0) return null;
    if (sourceOffset + byteLength > structure.binChunk.length) return null;

    outputOffset = (outputOffset + 3) & ~3;
    const newIndex = newViews.length;
    mapping.set(oldIndex, newIndex);
    const newView = { ...view, byteOffset: outputOffset };
    newViews.push(newView);
    copyPlan.push({ sourceOffset, byteLength, destinationOffset: outputOffset });
    outputOffset += byteLength;
  }

  if (!mapping.size) return null;
  remapBufferViewRefs(gltf, mapping);
  gltf.bufferViews = newViews;
  const binLength = (outputOffset + 3) & ~3;
  gltf.buffers[0].byteLength = binLength;
  return { copyPlan, binLength };
}

async function copyRange(sourceHandle, destinationHandle, sourcePosition, length, destinationPosition) {
  if (!length) return;
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_SIZE, length));
  let copied = 0;
  while (copied < length) {
    const wanted = Math.min(buffer.length, length - copied);
    const { bytesRead } = await sourceHandle.read(buffer, 0, wanted, sourcePosition + copied);
    if (!bytesRead) throw new Error('GLB kopyalanırken kaynak beklenmedik şekilde sona erdi.');
    await writeExact(destinationHandle, buffer.subarray(0, bytesRead), destinationPosition + copied);
    copied += bytesRead;
  }
}

async function sanitizeGeometryGlbFile(source, destination) {
  const structure = await readGlbStructure(source);
  const sanitized = sanitizeGeometryJson(structure.gltf);
  const compaction = buildBinCompaction(sanitized.gltf, structure, sanitized.removableImageViews);

  let json = Buffer.from(JSON.stringify(sanitized.gltf), 'utf8');
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);

  const totalLength = 12 + structure.chunks.reduce((sum, chunk) => {
    if (chunk === structure.jsonChunk) return sum + 8 + json.length;
    if (chunk === structure.binChunk && compaction) return sum + 8 + compaction.binLength;
    return sum + 8 + chunk.length;
  }, 0);
  if (totalLength > 0xffffffff) throw new Error('GLB 4 GB sınırını aşıyor.');

  const sourceHandle = await fs.promises.open(source, 'r');
  const destinationHandle = await fs.promises.open(destination, 'w');
  try {
    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);
    await writeExact(destinationHandle, header, 0);

    let outPosition = 12;
    for (const chunk of structure.chunks) {
      const isJson = chunk === structure.jsonChunk;
      const isCompactedBin = chunk === structure.binChunk && compaction;
      const dataLength = isJson ? json.length : isCompactedBin ? compaction.binLength : chunk.length;
      const chunkHeader = Buffer.allocUnsafe(8);
      chunkHeader.writeUInt32LE(dataLength, 0);
      chunkHeader.writeUInt32LE(chunk.type, 4);
      await writeExact(destinationHandle, chunkHeader, outPosition);
      outPosition += 8;

      if (isJson) {
        await writeExact(destinationHandle, json, outPosition);
      } else if (isCompactedBin) {
        for (const item of compaction.copyPlan) {
          await copyRange(
            sourceHandle,
            destinationHandle,
            structure.binChunk.dataOffset + item.sourceOffset,
            item.byteLength,
            outPosition + item.destinationOffset
          );
        }
      } else {
        await copyRange(sourceHandle, destinationHandle, chunk.dataOffset, chunk.length, outPosition);
      }
      outPosition += dataLength;
    }
    await destinationHandle.truncate(totalLength);
  } finally {
    await Promise.allSettled([sourceHandle.close(), destinationHandle.close()]);
  }
}

async function atomicReplace(tempFile, destination) {
  await fs.promises.rm(destination, { force: true });
  await fs.promises.rename(tempFile, destination);
}

async function findSafePreviousCache(cacheRoot, map) {
  for (const version of ['v5', 'v4']) {
    const candidate = path.join(cacheRoot, `${map}.${version}.glb`);
    if (await isSafeGlb(candidate)) return candidate;
  }
  return null;
}

async function findReusableRaw(cacheRoot, map) {
  const direct = path.join(cacheRoot, `${map}.v3.glb`);
  if (await isUsableRawGlb(direct)) return direct;

  // Prefer old exports that still contain the original image bufferView metadata. v6 can then
  // physically remove those image bytes instead of merely ignoring the texture references.
  for (const version of ['v3', 'v4', 'v5', 'v6']) {
    const exportDir = path.join(cacheRoot, `export-${version}`);
    const glbs = await listRecursive(exportDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
    if (!glbs.length) continue;
    const chosen = await chooseExport(glbs, map);
    if (chosen && await isUsableRawGlb(chosen)) return chosen;
  }
  return null;
}

function registerAsset(file) {
  const token = crypto.randomUUID();
  served.set(token, file);
  return `matchframe-pov://asset/${token}/${encodeURIComponent(path.basename(file))}`;
}

async function buildSafeCache(cacheRoot, map, mapVpk, gameInfo, cachedGlb) {
  const tempFile = `${cachedGlb}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.rm(tempFile, { force: true });

  try {
    // Prefer the old raw v3/export output. It lets us remove embedded texture payloads from the
    // BIN chunk while streaming, which makes the final file dramatically smaller and faster to
    // load than the old v4/v5 caches that only removed JSON texture references.
    const rawPrevious = await findReusableRaw(cacheRoot, map);
    if (rawPrevious) {
      await sanitizeGeometryGlbFile(rawPrevious, tempFile);
      await atomicReplace(tempFile, cachedGlb);
      return 'compacted-existing-export';
    }

    // If the raw source was already cleaned up, an old safe cache is still better than invoking
    // Source2Viewer again. Babylon's own loading overlay is disabled by pov.js, so this remains
    // a usable fallback even when that legacy cache is larger than ideal.
    const safePrevious = await findSafePreviousCache(cacheRoot, map);
    if (safePrevious) {
      await fs.promises.copyFile(safePrevious, tempFile);
      await atomicReplace(tempFile, cachedGlb);
      return 'reused-safe-cache';
    }

    // True first run only. Keep the CLI hidden and geometry-only; never use its heavy texture
    // export path. A hard timeout also prevents a stuck child process from living forever.
    const cli = await ensureVrf();
    const exportDir = path.join(cacheRoot, `export-${CACHE_VERSION}`);
    await fs.promises.rm(exportDir, { recursive: true, force: true });
    await fs.promises.mkdir(exportDir, { recursive: true });
    const internal = `maps/${map}.vmap_c`;

    await execFileAsync(cli, [
      '-i', mapVpk,
      '-o', exportDir,
      '-d',
      '--vpk_filepath', internal,
      '--gltf_export_format', 'glb',
      '--threads', '1',
      '--game', gameInfo
    ], { timeout: 180000 });

    const glbs = await listRecursive(exportDir, (_full, name) => name.toLowerCase().endsWith('.glb'));
    const chosen = await chooseExport(glbs, map);
    if (!chosen || !(await isUsableRawGlb(chosen))) throw new Error('Haritanın kullanılabilir GLB çıktısı bulunamadı.');
    await sanitizeGeometryGlbFile(chosen, tempFile);
    await atomicReplace(tempFile, cachedGlb);
    return 'fresh-geometry-export';
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch(() => {});
  }
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

    let cacheSource = 'existing-v6';
    if (!(await isSafeGlb(cachedGlb))) {
      cacheSource = await buildSafeCache(cacheRoot, map, mapVpk, gameInfo, cachedGlb);
    }
    if (!(await isSafeGlb(cachedGlb))) throw new Error('POV cache oluşturuldu fakat doğrulanamadı.');

    return {
      ok: true,
      map,
      url: registerAsset(cachedGlb),
      sourceScale: 0.0254,
      renderer: `Source 2 Viewer ${VRF_VERSION} cached geometry / compact safe-colour conversion`,
      cacheVersion: CACHE_VERSION,
      cacheSource,
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
      return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary' } });
    } catch (error) {
      return new Response(String(error?.message || error), { status: 500 });
    }
  });
}

module.exports = { prepare, installProtocol, cacheVersion: CACHE_VERSION };
