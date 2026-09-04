(() => {
  let engine = null;
  let scene = null;
  let camera = null;
  let canvas = null;
  let loadedUrl = null;
  let ready = false;
  let lastFps = 0;

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
    // VRF exports glTF as right-handed Y-up/metres. Keep the scene right-handed so there is
    // no hidden handedness flip between the exported map and our Source->glTF camera transform.
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0.035, 0.035, 0.043, 1);
    camera = new BABYLON.UniversalCamera('matchframe-pov', new BABYLON.Vector3(0, 1.6, 0), scene);
    camera.fov = BABYLON.Tools.ToRadians(90);
    camera.minZ = 0.015;
    camera.maxZ = 10000;
    camera.inputs.clear();
    camera.upVector.set(0, 1, 0);
    scene.activeCamera = camera;
    const hemi = new BABYLON.HemisphericLight('mf-hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.92;
    const sun = new BABYLON.DirectionalLight('mf-sun', new BABYLON.Vector3(-0.35, -0.8, 0.2), scene);
    sun.intensity = 0.38;
    ready = false;
    return scene;
  }

  async function load(url) {
    if (ready && loadedUrl === url) return;
    const target = createScene();
    try {
      await BABYLON.SceneLoader.AppendAsync('', url, target, undefined, '.glb');
      loadedUrl = url;
      ready = true;
      engine.resize();
    } catch (error) {
      ready = false;
      throw new Error(`Offline map yüklenemedi: ${error?.message || error}`);
    }
  }

  function sourceToGltf(x, y, z) {
    // VRF: Source 2 RH Z-up inches -> glTF RH Y-up metres.
    // Preserve handedness by mapping Source (X,Y,Z) => glTF (X,Z,-Y).
    const u = 0.0254;
    return new BABYLON.Vector3(x * u, z * u, -y * u);
  }

  function sourceForward(pitchDeg, yawDeg) {
    // Source 2 QAngle: +X forward, +Y left, +Z up; pitch positive down, yaw positive left.
    const pitch = BABYLON.Tools.ToRadians(Number(pitchDeg || 0));
    const yaw = BABYLON.Tools.ToRadians(Number(yawDeg || 0));
    const cp = Math.cos(pitch);
    return {
      x: cp * Math.cos(yaw),
      y: cp * Math.sin(yaw),
      z: -Math.sin(pitch)
    };
  }

  function setPlayer(player) {
    if (!ready || !camera || !player) return;
    const X = Number(player.X), Y = Number(player.Y), Z = Number(player.Z);
    if (![X, Y, Z].every(Number.isFinite)) return;

    const duck = Math.max(0, Math.min(1, Number(player.duck_amount || 0)));
    // CS standing/crouched view heights are approximately 64/46 Source units; duck_amount is
    // continuously interpolated by the game, so use the same continuous eye transition.
    const eyeHeight = 64 - 18 * duck;
    const position = sourceToGltf(X, Y, Z + eyeHeight);
    camera.position.copyFrom(position);

    const forwardSource = sourceForward(player.pitch, player.yaw);
    const forward = sourceToGltf(forwardSource.x / 0.0254, forwardSource.y / 0.0254, forwardSource.z / 0.0254).normalize();
    camera.setTarget(position.add(forward));

    const fov = Number(player.fov || 90);
    if (Number.isFinite(fov) && fov > 20 && fov < 170) {
      camera.fov = BABYLON.Tools.ToRadians(fov);
    }
  }

  function isReady() { return ready; }
  function resize() { engine?.resize(); }
  function fps() { return lastFps; }
  function reset() {
    loadedUrl = null;
    ready = false;
    if (scene) { scene.dispose(); scene = null; }
  }

  window.matchframePov = { load, setPlayer, isReady, resize, fps, reset };
})();
