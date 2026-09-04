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
        if (scene && ready && !canvas.classList.contains('hidden')) scene.render();
      });
      window.addEventListener('resize', () => engine?.resize());
      new ResizeObserver(() => engine?.resize()).observe(document.getElementById('viewport'));
    }
    if (scene) scene.dispose();
    scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0.035, 0.035, 0.043, 1);
    camera = new BABYLON.UniversalCamera('matchframe-pov', new BABYLON.Vector3(0, 1.6, 0), scene);
    camera.fov = BABYLON.Tools.ToRadians(90);
    camera.minZ = 0.02;
    camera.maxZ = 20000;
    camera.inputs.clear();
    camera.upVector.set(0, 1, 0);
    scene.activeCamera = camera;
    const hemi = new BABYLON.HemisphericLight('mf-hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.92;
    const sun = new BABYLON.DirectionalLight('mf-sun', new BABYLON.Vector3(-0.35, -0.8, 0.2), scene);
    sun.intensity = 0.38;
    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
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
    return count ? { min, max } : null;
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
      sceneBounds = calculateSceneBounds(target);
      loadedUrl = url;
      ready = true;
      engine.resize();
    } catch (error) {
      ready = false;
      throw new Error(`Offline map yüklenemedi: ${error?.message || error}`);
    }
  }

  // ValveResourceFormat's glTF exporter uses SourceToGltfRotation where
  // Source +X -> glTF +Z, Source +Y -> glTF +X, Source +Z -> glTF +Y,
  // and converts Source inches to glTF metres.
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
    const margin = Math.max(6, Math.max(size.x, size.y, size.z) * 0.08);
    return position.x >= sceneBounds.min.x - margin && position.x <= sceneBounds.max.x + margin &&
      position.y >= sceneBounds.min.y - margin && position.y <= sceneBounds.max.y + margin &&
      position.z >= sceneBounds.min.z - margin && position.z <= sceneBounds.max.z + margin;
  }

  function usablePlayer(player) {
    if (!player) return false;
    const X = Number(player.X), Y = Number(player.Y), Z = Number(player.Z);
    if (![X, Y, Z].every(Number.isFinite)) return false;
    // Parser gaps were previously converted to 0/0/0, which parked the camera at map origin.
    if (X === 0 && Y === 0 && Z === 0) return false;
    const duck = Math.max(0, Math.min(1, Number(player.duck_amount || 0)));
    const eyeHeight = 64 - 18 * duck;
    return positionLooksUsable(sourceToGltf(X, Y, Z + eyeHeight));
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
  function resize() { engine?.resize(); }
  function fps() { return lastFps; }
  function isPlayerUsable(player) { return usablePlayer(player); }
  function reset() {
    loadedUrl = null;
    ready = false;
    sceneBounds = null;
    lastGoodPlayer = null;
    if (scene) { scene.dispose(); scene = null; }
  }

  window.matchframePov = { load, setPlayer, isReady, resize, fps, reset, isPlayerUsable };
})();
