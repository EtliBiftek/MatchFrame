(() => {
  let engine = null;
  let scene = null;
  let camera = null;
  let canvas = null;
  let loadedUrl = null;
  let ready = false;

  function createScene() {
    if (!window.BABYLON) throw new Error('Babylon.js yüklenmedi.');
    if (!canvas) canvas = document.getElementById('povCanvas');
    if (!canvas) throw new Error('POV canvas bulunamadı.');
    if (!engine) {
      engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
      engine.runRenderLoop(() => {
        if (scene && ready && !canvas.classList.contains('hidden')) scene.render();
      });
      window.addEventListener('resize', () => engine?.resize());
      new ResizeObserver(() => engine?.resize()).observe(document.getElementById('viewport'));
    }
    if (scene) scene.dispose();
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.035, 0.035, 0.043, 1);
    scene.useRightHandedSystem = false;
    camera = new BABYLON.UniversalCamera('matchframe-pov', new BABYLON.Vector3(0, 1.6, 0), scene);
    camera.fov = BABYLON.Tools.ToRadians(90);
    camera.minZ = 0.015;
    camera.maxZ = 10000;
    camera.inputs.clear();
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

  function setPlayer(player) {
    if (!ready || !camera || !player) return;
    const X = Number(player.X), Y = Number(player.Y), Z = Number(player.Z);
    if (![X, Y, Z].every(Number.isFinite)) return;
    // VRF glTF export bakes Source units to metres. Source Z-up -> glTF/Babylon Y-up.
    const u = 0.0254;
    const eye = 64 * u;
    camera.position.set(X * u, Z * u + eye, -Y * u);
    const pitch = Number(player.pitch || 0);
    const yaw = Number(player.yaw || 0);
    camera.rotation.x = BABYLON.Tools.ToRadians(pitch);
    camera.rotation.y = BABYLON.Tools.ToRadians(yaw + 90);
    camera.rotation.z = 0;
  }

  function isReady() { return ready; }
  function resize() { engine?.resize(); }
  function reset() {
    loadedUrl = null;
    ready = false;
    if (scene) { scene.dispose(); scene = null; }
  }

  window.matchframePov = { load, setPlayer, isReady, resize, reset };
})();
