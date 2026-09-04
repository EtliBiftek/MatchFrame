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
  let needsVisibleResize = false;
  let renderableMeshCount = 0;
  let materialCount = 0;

  function createScene() {
    if (!window.BABYLON) throw new Error('Babylon.js yüklenmedi.');
    if (!canvas) canvas = document.getElementById('povCanvas');
    if (!canvas) throw new Error('POV canvas bulunamadı.');
    if (!engine) {
      engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: false,
        stencil: true,
        adaptToDeviceRatio: true,
        powerPreference: 'high-performance'
      });
      engine.setHardwareScalingLevel(1);
      engine.runRenderLoop(() => {
        lastFps = engine.getFps();
        if (scene && ready && !canvas.classList.contains('hidden')) {
          if (needsVisibleResize) {
            engine.resize(true);
            needsVisibleResize = false;
          }
          scene.render();
        }
      });
      window.addEventListener('resize', () => engine?.resize(true));
      new ResizeObserver(() => {
        if (canvas && !canvas.classList.contains('hidden')) engine?.resize(true);
      }).observe(document.getElementById('viewport'));
    }
    if (scene) scene.dispose();
    scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0.035, 0.035, 0.043, 1);
    scene.skipPointerMovePicking = true;
    camera = new BABYLON.UniversalCamera('matchframe-pov', new BABYLON.Vector3(0, 1.6, 0), scene);
    camera.fov = BABYLON.Tools.ToRadians(90);
    camera.minZ = 0.015;
    camera.maxZ = 20000;
    camera.inputs.clear();
    camera.upVector.set(0, 1, 0);
    scene.activeCamera = camera;

    // Direct lights are kept as a fallback for non-PBR materials. VRF map PBR materials are
    // switched to unlit after import because this offline renderer has no Source 2 light probes / IBL.
    const hemi = new BABYLON.HemisphericLight('mf-hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 1.0;
    const sun = new BABYLON.DirectionalLight('mf-sun', new BABYLON.Vector3(-0.35, -0.8, 0.2), scene);
    sun.intensity = 0.5;

    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
    needsVisibleResize = true;
    renderableMeshCount = 0;
    materialCount = 0;
    return scene;
  }

  function calculateSceneBounds(target) {
    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
    let count = 0;
    for (const mesh of target.meshes || []) {
      if (!mesh || typeof mesh.getBoundingInfo !== 'function' || !mesh.getTotalVertices?.()) continue;
      try {
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

  function stabilizeImportedMaterials(target) {
    materialCount = target.materials?.length || 0;
    for (const material of target.materials || []) {
      try {
        // VRF exports Source 2 materials as glTF PBR. Without Source's environment/light-probe
        // data, highly metallic PBR surfaces can evaluate to almost pure black in Babylon.
        // Fullbright/unlit preserves the exported albedo/texture while remaining completely offline.
        if (BABYLON.PBRMaterial && material instanceof BABYLON.PBRMaterial) {
          material.unlit = true;
          material.environmentIntensity = 0;
        } else if ('disableLighting' in material) {
          material.disableLighting = true;
        }
      } catch (_) {}
    }
  }

  async function load(url) {
    if (ready && loadedUrl === url) return;
    const target = createScene();
    try {
      await BABYLON.SceneLoader.AppendAsync('', url, target, undefined, '.glb');
      for (const item of [...target.cameras]) {
        if (item !== camera) item.dispose();
      }
      target.activeCamera = camera;
      stabilizeImportedMaterials(target);
      sceneBounds = calculateSceneBounds(target);
      if (!sceneBounds || renderableMeshCount === 0) {
        throw new Error('GLB yüklendi fakat render edilebilir map mesh’i bulunamadı. POV cache yeniden oluşturulmalı.');
      }
      loadedUrl = url;
      ready = true;
      needsVisibleResize = true;
      // The canvas is normally display:none while the GLB is prepared. Resizing here alone can
      // therefore produce a 0x0 render target. setPlayer/renderLoop force a second resize after unhide.
      engine.resize(true);
    } catch (error) {
      ready = false;
      throw new Error(`Offline map yüklenemedi: ${error?.message || error}`);
    }
  }

  // ValveResourceFormat's SourceToGltfRotation maps Source +X -> glTF +Z,
  // Source +Y -> glTF +X and Source +Z -> glTF +Y; Source inches become metres.
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
    // Map exports can include separated sky/prop geometry. Be generous here and reject only
    // coordinates that are clearly unrelated to the loaded map.
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

  function ensureVisibleRenderSize() {
    if (!engine || !canvas || canvas.classList.contains('hidden')) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) {
      needsVisibleResize = true;
      return;
    }
    if (needsVisibleResize || engine.getRenderWidth() <= 1 || engine.getRenderHeight() <= 1) {
      engine.resize(true);
      needsVisibleResize = false;
      requestAnimationFrame(() => engine?.resize(true));
    }
  }

  function setPlayer(player) {
    if (!ready || !camera || !player) return false;
    let state = player;
    if (!usablePlayer(state)) {
      if (!lastGoodPlayer || !usablePlayer(lastGoodPlayer)) return false;
      state = lastGoodPlayer;
    } else {
      lastGoodPlayer = { ...state };
    }

    ensureVisibleRenderSize();

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
    needsVisibleResize = true;
    ensureVisibleRenderSize();
  }
  function fps() { return lastFps; }
  function isPlayerUsable(player) { return usablePlayer(player); }
  function diagnostics() {
    return {
      ready,
      renderableMeshCount,
      materialCount,
      renderWidth: engine?.getRenderWidth?.() || 0,
      renderHeight: engine?.getRenderHeight?.() || 0,
      bounds: sceneBounds ? {
        min: { x: sceneBounds.min.x, y: sceneBounds.min.y, z: sceneBounds.min.z },
        max: { x: sceneBounds.max.x, y: sceneBounds.max.y, z: sceneBounds.max.z }
      } : null
    };
  }
  function reset() {
    loadedUrl = null;
    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
    needsVisibleResize = true;
    renderableMeshCount = 0;
    materialCount = 0;
    if (scene) { scene.dispose(); scene = null; }
  }

  window.matchframePov = { load, setPlayer, isReady, resize, fps, reset, isPlayerUsable, diagnostics };
})();
