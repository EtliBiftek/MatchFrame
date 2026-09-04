(() => {
  let engine = null;
  let scene = null;
  let camera = null;
  let canvas = null;
  let loadedUrl = null;
  let ready = false;
  let lastFps = 0;
  let sceneBounds = null;
  let lastGoodPlayer = null;
  let renderableMeshCount = 0;
  let materialCount = 0;
  let textureCount = 0;
  let resizePending = true;
  let contextLost = false;

  // IMPORTANT: never let the Babylon canvas become display:none. Babylon has had a
  // long-standing failure mode where resize() on a zero-sized/hidden canvas can grow the
  // backing buffer by DPR repeatedly and eventually lose the WebGL context. MatchFrame used
  // the global .hidden class on this canvas while the GLB was loading, which matches the
  // red/orange compositor corruption followed by an all-black Electron window we observed.
  const style = document.createElement('style');
  style.textContent = `
    #povCanvas.hidden{display:block!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
    #povCanvas{contain:strict;transform:translateZ(0);will-change:contents}
    #viewport{isolation:isolate}
  `;
  document.head.appendChild(style);

  function ensureCanvas() {
    if (!canvas) canvas = document.getElementById('povCanvas');
    if (!canvas) throw new Error('POV canvas bulunamadı.');
    return canvas;
  }

  function cssRenderSize() {
    ensureCanvas();
    const rect = canvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 1 || rect.height <= 1) return null;

    // POV intentionally renders at CSS-pixel resolution. A full CS2 map already consumes a
    // lot of GPU memory; multiplying the render target by Windows DPR gives almost no useful
    // replay detail but can be enough to evict the WebGL context.
    const width = Math.max(2, Math.min(2560, Math.round(rect.width)));
    const height = Math.max(2, Math.min(1440, Math.round(rect.height)));
    return { width, height, cssWidth: rect.width, cssHeight: rect.height };
  }

  function syncRenderSize(force = false) {
    if (!engine) return false;
    const wanted = cssRenderSize();
    if (!wanted) {
      resizePending = true;
      return false;
    }
    const currentW = Number(engine.getRenderWidth?.() || 0);
    const currentH = Number(engine.getRenderHeight?.() || 0);
    if (force || resizePending || Math.abs(currentW - wanted.width) > 1 || Math.abs(currentH - wanted.height) > 1) {
      engine.setSize(wanted.width, wanted.height, true);
      resizePending = false;
    }
    return true;
  }

  function disposeEngineOnly() {
    try { engine?.stopRenderLoop?.(); } catch (_) {}
    try { scene?.dispose?.(); } catch (_) {}
    try { engine?.dispose?.(); } catch (_) {}
    scene = null;
    camera = null;
    engine = null;
    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
    renderableMeshCount = 0;
    materialCount = 0;
    textureCount = 0;
    resizePending = true;
  }

  function createScene() {
    if (!window.BABYLON) throw new Error('Babylon.js yüklenmedi.');
    ensureCanvas();

    // The canvas stays in layout even while visually hidden, so these dimensions are real.
    if (!cssRenderSize()) throw new Error('POV görüntü alanı henüz boyutlandırılmadı.');

    if (!engine) {
      engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: false,
        stencil: false,
        adaptToDeviceRatio: false,
        powerPreference: 'high-performance'
      });
      engine.setHardwareScalingLevel(1);
      engine.enableOfflineSupport = false;
      syncRenderSize(true);

      engine.runRenderLoop(() => {
        lastFps = engine?.getFps?.() || 0;
        if (!engine || !scene || !ready || contextLost || canvas.classList.contains('hidden')) return;
        try {
          syncRenderSize(false);
          scene.render();
        } catch (error) {
          console.error('[MatchFrame POV render]', error);
        }
      });

      window.addEventListener('resize', () => { resizePending = true; });
      const viewport = document.getElementById('viewport');
      if (viewport) new ResizeObserver(() => { resizePending = true; }).observe(viewport);

      canvas.addEventListener('webglcontextlost', (event) => {
        // Preventing the default tells Chromium that restoration is allowed. Babylon also has
        // its own context-loss handling; we only stop issuing new draws until restoration.
        event.preventDefault();
        contextLost = true;
        resizePending = true;
        console.warn('[MatchFrame POV] WebGL context lost');
      }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        contextLost = false;
        resizePending = true;
        syncRenderSize(true);
        console.info('[MatchFrame POV] WebGL context restored');
      }, false);
    }

    if (scene) scene.dispose();
    scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0.035, 0.035, 0.043, 1);
    scene.skipPointerMovePicking = true;

    camera = new BABYLON.UniversalCamera('matchframe-pov', new BABYLON.Vector3(0, 1.6, 0), scene);
    camera.fov = BABYLON.Tools.ToRadians(90);
    camera.minZ = 0.025;
    camera.maxZ = 20000;
    camera.inputs.clear();
    camera.upVector.set(0, 1, 0);
    scene.activeCamera = camera;

    const hemi = new BABYLON.HemisphericLight('mf-hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.82;
    const sun = new BABYLON.DirectionalLight('mf-sun', new BABYLON.Vector3(-0.35, -0.8, 0.2), scene);
    sun.intensity = 0.72;

    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
    renderableMeshCount = 0;
    materialCount = 0;
    textureCount = 0;
    resizePending = true;
    return scene;
  }

  function calculateSceneBounds(target) {
    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
    let count = 0;
    for (const mesh of target.meshes || []) {
      if (!mesh || typeof mesh.getBoundingInfo !== 'function' || !mesh.getTotalVertices?.()) continue;
      try {
        if (mesh.getTotalVertices() <= 0) continue;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        const lo = box.minimumWorld;
        const hi = box.maximumWorld;
        if (![lo.x, lo.y, lo.z, hi.x, hi.y, hi.z].every(Number.isFinite)) continue;
        min = BABYLON.Vector3.Minimize(min, lo);
        max = BABYLON.Vector3.Maximize(max, hi);
        count++;
      } catch (_) {}
    }
    renderableMeshCount = count;
    return count ? { min, max } : null;
  }

  function installStableGeometryMaterial(target) {
    const importedMaterials = [...(target.materials || [])];
    const importedTextures = [...(target.textures || [])];
    materialCount = importedMaterials.length;
    textureCount = importedTextures.length;

    const stable = new BABYLON.StandardMaterial('mf-stable-map', target);
    stable.diffuseColor = new BABYLON.Color3(0.48, 0.50, 0.53);
    stable.ambientColor = new BABYLON.Color3(0.18, 0.18, 0.19);
    stable.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    stable.backFaceCulling = false;
    stable.twoSidedLighting = true;

    for (const mesh of target.meshes || []) {
      try {
        if (!mesh?.getTotalVertices?.() || mesh.getTotalVertices() <= 0) continue;
        // VRF currently has map exports where vertex colour/alpha can produce the giant
        // red/orange polygons visible in the user's screenshot. Ignore all vertex tinting.
        mesh.useVertexColors = false;
        mesh.hasVertexAlpha = false;
        mesh.material = stable;
      } catch (_) {}
    }

    // Even if skipMaterials is ignored by an older loader, release every imported texture and
    // material after replacing them. This keeps the full map geometry while dropping the main
    // source of GPU-memory/context-loss pressure.
    for (const material of importedMaterials) {
      if (material !== stable) {
        try { material.dispose(true, true); } catch (_) {}
      }
    }
    for (const texture of importedTextures) {
      try { texture.dispose(); } catch (_) {}
    }
  }

  async function appendGeometryOnly(target, url) {
    // Babylon's glTF loader exposes skipMaterials. Setting it on plugin activation means the
    // embedded textures in VRF's large GLB are not decoded/uploaded to the GPU at all.
    let observer = null;
    const observable = BABYLON.SceneLoader?.OnPluginActivatedObservable;
    if (observable?.add) {
      observer = observable.add((plugin) => {
        try {
          if (plugin && 'skipMaterials' in plugin) plugin.skipMaterials = true;
        } catch (_) {}
      });
    }
    try {
      await BABYLON.SceneLoader.AppendAsync('', url, target, undefined, '.glb');
    } finally {
      if (observer && observable?.remove) observable.remove(observer);
    }
  }

  async function load(url) {
    if (ready && loadedUrl === url) return;
    const target = createScene();
    try {
      await appendGeometryOnly(target, url);
      for (const item of [...target.cameras]) {
        if (item !== camera) item.dispose();
      }
      target.activeCamera = camera;
      installStableGeometryMaterial(target);
      sceneBounds = calculateSceneBounds(target);
      if (!sceneBounds || renderableMeshCount === 0) {
        throw new Error('GLB yüklendi fakat render edilebilir map mesh’i bulunamadı.');
      }
      loadedUrl = url;
      ready = true;
      resizePending = true;
      syncRenderSize(true);
    } catch (error) {
      ready = false;
      throw new Error(`Offline map yüklenemedi: ${error?.message || error}`);
    }
  }

  // ValveResourceFormat SourceToGltfRotation:
  // Source +X -> glTF +Z, Source +Y -> glTF +X, Source +Z -> glTF +Y.
  // Source units are inches and glTF units are metres.
  function sourceToGltf(x, y, z) {
    const u = 0.0254;
    return new BABYLON.Vector3(Number(y) * u, Number(z) * u, Number(x) * u);
  }

  function sourceDirectionToGltf(x, y, z) {
    return new BABYLON.Vector3(Number(y), Number(z), Number(x));
  }

  function sourceForward(pitchDeg, yawDeg) {
    const pitch = BABYLON.Tools.ToRadians(Number(pitchDeg || 0));
    const yaw = BABYLON.Tools.ToRadians(Number(yawDeg || 0));
    const cp = Math.cos(pitch);
    return {
      x: cp * Math.cos(yaw),
      y: cp * Math.sin(yaw),
      z: -Math.sin(pitch)
    };
  }

  function positionLooksUsable(position) {
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return false;
    if (!sceneBounds) return true;
    const size = sceneBounds.max.subtract(sceneBounds.min);
    const margin = Math.max(25, Math.max(size.x, size.y, size.z) * 0.35);
    return position.x >= sceneBounds.min.x - margin && position.x <= sceneBounds.max.x + margin &&
      position.y >= sceneBounds.min.y - margin && position.y <= sceneBounds.max.y + margin &&
      position.z >= sceneBounds.min.z - margin && position.z <= sceneBounds.max.z + margin;
  }

  function usablePlayer(player) {
    if (!player) return false;
    const X = Number(player.X), Y = Number(player.Y), Z = Number(player.Z);
    if (![X, Y, Z].every(Number.isFinite)) return false;
    if (X === 0 && Y === 0 && Z === 0) return false;
    const duck = Math.max(0, Math.min(1, Number(player.duck_amount || 0)));
    const eyeHeight = 64 - 18 * duck;
    return positionLooksUsable(sourceToGltf(X, Y, Z + eyeHeight));
  }

  function setPlayer(player) {
    if (!ready || !camera || !player || contextLost) return false;
    let state = player;
    if (!usablePlayer(state)) {
      if (!lastGoodPlayer || !usablePlayer(lastGoodPlayer)) return false;
      state = lastGoodPlayer;
    } else {
      lastGoodPlayer = { ...state };
    }

    syncRenderSize(false);

    const X = Number(state.X), Y = Number(state.Y), Z = Number(state.Z);
    const duck = Math.max(0, Math.min(1, Number(state.duck_amount || 0)));
    const eyeHeight = 64 - 18 * duck;
    const position = sourceToGltf(X, Y, Z + eyeHeight);
    camera.position.copyFrom(position);

    const src = sourceForward(state.pitch, state.yaw);
    const forward = sourceDirectionToGltf(src.x, src.y, src.z).normalize();
    camera.setTarget(position.add(forward));

    const fov = Number(state.fov || 90);
    if (Number.isFinite(fov) && fov > 20 && fov < 170) camera.fov = BABYLON.Tools.ToRadians(fov);
    scene.activeCamera = camera;
    return true;
  }

  function isReady() { return ready; }
  function resize() {
    resizePending = true;
    if (!canvas?.classList.contains('hidden')) syncRenderSize(false);
  }
  function fps() { return lastFps; }
  function isPlayerUsable(player) { return usablePlayer(player); }
  function diagnostics() {
    const wanted = cssRenderSize();
    return {
      ready,
      contextLost,
      renderableMeshCount,
      materialCount,
      textureCount,
      renderWidth: engine?.getRenderWidth?.() || 0,
      renderHeight: engine?.getRenderHeight?.() || 0,
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      cssWidth: wanted?.cssWidth || 0,
      cssHeight: wanted?.cssHeight || 0,
      bounds: sceneBounds ? {
        min: { x: sceneBounds.min.x, y: sceneBounds.min.y, z: sceneBounds.min.z },
        max: { x: sceneBounds.max.x, y: sceneBounds.max.y, z: sceneBounds.max.z }
      } : null
    };
  }
  function reset() {
    loadedUrl = null;
    contextLost = false;
    disposeEngineOnly();
  }

  window.matchframePov = { load, setPlayer, isReady, resize, fps, reset, isPlayerUsable, diagnostics };
})();
