(() => {
  let sceneRef = null;
  let actorMeshes = new Map();
  let utilityMeshes = [];
  let bombMesh = null;
  let viewModelRoot = null;
  let viewModelKey = '';
  let worldDisabledForScene = false;
  let lastWorldError = '';
  const materialCache = new Map();

  const PLAYER_COLORS = {
    blue: '#5d79ae',
    green: '#04b462',
    yellow: '#d5e800',
    orange: '#d58b00',
    purple: '#b25de5'
  };

  function scene() {
    return window.matchframePov?.getScene?.() || null;
  }

  function ensureSceneState() {
    const current = scene();
    if (!current || current.isDisposed) return null;
    if (current === sceneRef) return current;
    actorMeshes = new Map();
    utilityMeshes = [];
    bombMesh = null;
    viewModelRoot = null;
    viewModelKey = '';
    worldDisabledForScene = false;
    lastWorldError = '';
    materialCache.clear();
    sceneRef = current;
    return current;
  }

  function color3(hex) {
    try { return BABYLON.Color3.FromHexString(hex); } catch (_) { return new BABYLON.Color3(.6, .6, .6); }
  }

  function material(key, hex, alpha = 1, emissive = .08) {
    const s = ensureSceneState();
    if (!s) return null;
    const cacheKey = `${key}:${hex}:${alpha}`;
    if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);
    const mat = new BABYLON.StandardMaterial(`mf-${key}-${materialCache.size}`, s);
    const c = color3(hex);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(emissive);
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = alpha;
    mat.backFaceCulling = false;
    if (alpha < 1) {
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      mat.disableDepthWrite = false;
    }
    materialCache.set(cacheKey, mat);
    return mat;
  }

  function playerColor(player) {
    const own = PLAYER_COLORS[String(player?.player_color || '').toLowerCase()];
    if (own) return own;
    return Number(player?.team_num) === 2 ? '#d2ad69' : Number(player?.team_num) === 3 ? '#79a7c7' : '#9a9aa2';
  }

  function makeActor(steamid) {
    const s = ensureSceneState();
    if (!s) return null;
    const root = new BABYLON.TransformNode(`mf-actor-${steamid}`, s);
    const body = BABYLON.MeshBuilder.CreateCapsule
      ? BABYLON.MeshBuilder.CreateCapsule(`mf-body-${steamid}`, { height: 1.55, radius: .25, subdivisions: 6 }, s)
      : BABYLON.MeshBuilder.CreateCylinder(`mf-body-${steamid}`, { height: 1.4, diameter: .48, tessellation: 10 }, s);
    const head = BABYLON.MeshBuilder.CreateSphere(`mf-head-${steamid}`, { diameter: .43, segments: 10 }, s);
    const gun = BABYLON.MeshBuilder.CreateBox(`mf-gun-${steamid}`, { width: .09, height: .09, depth: .48 }, s);
    const c4 = BABYLON.MeshBuilder.CreateBox(`mf-c4-${steamid}`, { width: .22, height: .16, depth: .10 }, s);
    body.parent = root;
    head.parent = root;
    gun.parent = root;
    c4.parent = root;
    body.position.y = .78;
    head.position.y = 1.68;
    gun.position.set(.22, 1.12, .10);
    gun.rotation.x = .08;
    c4.position.set(-.26, .95, -.12);
    c4.material = material('c4', '#e9544d', 1, .25);
    root.metadata = { body, head, gun, c4 };
    actorMeshes.set(steamid, root);
    return root;
  }

  function updateActors(frame) {
    const s = ensureSceneState();
    if (!s || !frame) return;
    const selectedSteam = String(selectedPlayer?.steamid || '');
    const seen = new Set();
    for (const player of frame.players || []) {
      const steamid = String(player?.steamid || player?.name || '');
      if (!steamid || steamid === selectedSteam || !player?.is_alive || Number(player.health || 0) <= 0) continue;
      if (![player.X, player.Y, player.Z].every((v) => Number.isFinite(Number(v)))) continue;
      seen.add(steamid);
      const root = actorMeshes.get(steamid) || makeActor(steamid);
      if (!root) continue;
      root.setEnabled(true);
      const feet = window.matchframePov.sourceToGltf(player.X, player.Y, player.Z);
      root.position.copyFrom(feet);
      const yaw = BABYLON.Tools.ToRadians(Number(player.yaw || 0));
      root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, -yaw, 0);
      const mat = material(`player-${player.player_color || player.team_num}`, playerColor(player), .96, .16);
      root.metadata.body.material = mat;
      root.metadata.head.material = mat;
      root.metadata.gun.material = material(`gun-${player.team_num}`, Number(player.team_num) === 2 ? '#c6a56a' : '#7ea6c2', 1, .06);
      root.metadata.c4.setEnabled(Boolean(player.has_c4));
    }
    for (const [steamid, root] of actorMeshes) {
      if (!seen.has(steamid)) root.setEnabled(false);
    }
  }

  function eventTick(event) {
    const n = Number(event?.tick || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function eventPosition(event) {
    const X = Number(event?.user_X ?? event?.player_X ?? event?.X ?? event?.x);
    const Y = Number(event?.user_Y ?? event?.player_Y ?? event?.Y ?? event?.y);
    const Z = Number(event?.user_Z ?? event?.player_Z ?? event?.Z ?? event?.z ?? 0);
    return [X, Y, Z].every(Number.isFinite) ? { X, Y, Z } : null;
  }

  function currentRound() {
    for (const round of demo?.roundMeta || []) {
      if (currentTick >= Number(round.startTick) && currentTick <= Number(round.endTick)) return round;
    }
    return null;
  }

  function currentBombState() {
    const round = currentRound();
    if (!round) return null;
    const start = Number(round.startTick), end = Math.min(Number(round.endTick), currentTick);
    const bomb = demo?.bomb || {};
    const events = [];
    for (const event of bomb.plants || []) events.push({ type: 'plant', event, tick: eventTick(event) });
    for (const event of bomb.drops || []) events.push({ type: 'drop', event, tick: eventTick(event) });
    for (const event of bomb.pickups || []) events.push({ type: 'pickup', event, tick: eventTick(event) });
    for (const event of bomb.defuses || []) events.push({ type: 'defuse', event, tick: eventTick(event) });
    for (const event of bomb.explosions || []) events.push({ type: 'explode', event, tick: eventTick(event) });
    events.sort((a, b) => a.tick - b.tick);
    let state = null;
    for (const item of events) {
      if (item.tick < start || item.tick > end) continue;
      if (item.type === 'plant' || item.type === 'drop') {
        const pos = eventPosition(item.event);
        state = pos ? { type: item.type, position: pos } : state;
      } else if (item.type === 'pickup' || item.type === 'defuse' || item.type === 'explode') {
        state = null;
      }
    }
    return state;
  }

  function updateBomb() {
    const s = ensureSceneState();
    if (!s) return;
    const state = currentBombState();
    if (!state) {
      if (bombMesh) bombMesh.setEnabled(false);
      return;
    }
    if (!bombMesh) {
      bombMesh = BABYLON.MeshBuilder.CreateBox('mf-world-c4', { width: .34, height: .18, depth: .24 }, s);
      bombMesh.material = material('world-c4', '#ef5148', 1, .35);
    }
    bombMesh.setEnabled(true);
    const p = window.matchframePov.sourceToGltf(state.position.X, state.position.Y, state.position.Z + 6);
    bombMesh.position.copyFrom(p);
    const pulse = 1 + Math.sin(performance.now() / 100) * .12;
    bombMesh.scaling.setAll(pulse);
  }

  function clearUtilityMeshes() {
    for (const mesh of utilityMeshes) {
      try { mesh.dispose(false, false); } catch (_) {}
    }
    utilityMeshes = [];
  }

  function activeUtilityStarts() {
    const result = [];
    const tr = Number(demo?.tickRate || 64) || 64;
    const utility = demo?.utility || {};
    for (const event of utility.smokeStarts || []) {
      const tick = eventTick(event);
      if (currentTick >= tick && currentTick <= tick + tr * 18) {
        const p = eventPosition(event); if (p) result.push({ kind: 'smoke', p, age: (currentTick - tick) / tr });
      }
    }
    for (const event of utility.infernoStarts || []) {
      const tick = eventTick(event);
      if (currentTick >= tick && currentTick <= tick + tr * 7) {
        const p = eventPosition(event); if (p) result.push({ kind: 'fire', p, age: (currentTick - tick) / tr });
      }
    }
    for (const event of utility.heDetonates || []) {
      const tick = eventTick(event);
      if (currentTick >= tick && currentTick <= tick + tr * .55) {
        const p = eventPosition(event); if (p) result.push({ kind: 'he', p, age: (currentTick - tick) / tr });
      }
    }
    for (const event of utility.flashDetonates || []) {
      const tick = eventTick(event);
      if (currentTick >= tick && currentTick <= tick + tr * .45) {
        const p = eventPosition(event); if (p) result.push({ kind: 'flash', p, age: (currentTick - tick) / tr });
      }
    }
    return result;
  }

  let lastUtilityKey = '';
  function updateUtilities() {
    const s = ensureSceneState();
    if (!s) return;
    const active = activeUtilityStarts();
    const key = active.map((x) => `${x.kind}:${Math.round(x.p.X)}:${Math.round(x.p.Y)}:${Math.round(x.p.Z)}`).join('|');
    if (key !== lastUtilityKey) {
      clearUtilityMeshes();
      lastUtilityKey = key;
      for (const item of active) {
        const p = window.matchframePov.sourceToGltf(item.p.X, item.p.Y, item.p.Z + 12);
        let mesh;
        if (item.kind === 'smoke') {
          mesh = BABYLON.MeshBuilder.CreateSphere('mf-smoke', { diameter: 3.3, segments: 12 }, s);
          mesh.material = material('smoke', '#a7adb5', .34, .03);
        } else if (item.kind === 'fire') {
          mesh = BABYLON.MeshBuilder.CreateCylinder('mf-fire', { height: .08, diameter: 4.0, tessellation: 24 }, s);
          mesh.material = material('fire', '#ef873f', .42, .35);
        } else if (item.kind === 'he') {
          mesh = BABYLON.MeshBuilder.CreateSphere('mf-he', { diameter: 2.4, segments: 10 }, s);
          mesh.material = material('he', '#f0c46b', .28, .4);
        } else {
          mesh = BABYLON.MeshBuilder.CreateSphere('mf-flash', { diameter: 2.1, segments: 10 }, s);
          mesh.material = material('flash', '#fffbe8', .42, .8);
        }
        mesh.position.copyFrom(p);
        utilityMeshes.push(mesh);
      }
    }
  }

  function weaponKind(name) {
    const key = String(name || '').toLowerCase();
    if (/c4/.test(key)) return 'c4';
    if (/flash|smoke|grenade|molotov|incendiary|decoy/.test(key)) return 'grenade';
    if (/knife|bayonet/.test(key)) return 'knife';
    if (/glock|usp|p250|deagle|revolver|tec9|fiveseven|cz75|elite/.test(key)) return 'pistol';
    if (!key) return 'none';
    return 'rifle';
  }

  function buildViewModel(key) {
    const s = ensureSceneState();
    if (!s) return;
    try { viewModelRoot?.dispose?.(false, true); } catch (_) {}
    viewModelRoot = new BABYLON.TransformNode('mf-viewmodel', s);
    viewModelKey = key;
    if (key === 'none') return;
    const dark = material('viewmodel', '#34383f', 1, .08);
    const accent = material('viewmodel-accent', '#7c8794', 1, .12);
    const add = (mesh, pos, mat = dark) => { mesh.parent = viewModelRoot; mesh.position.copyFromFloats(...pos); mesh.material = mat; };
    if (key === 'grenade') {
      add(BABYLON.MeshBuilder.CreateSphere('mf-vm-grenade', { diameter: .18, segments: 10 }, s), [0, 0, 0]);
      add(BABYLON.MeshBuilder.CreateCylinder('mf-vm-pin', { height: .08, diameter: .035, tessellation: 8 }, s), [.04, .10, 0], accent);
    } else if (key === 'c4') {
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-c4', { width: .30, height: .20, depth: .09 }, s), [0, 0, 0], material('vm-c4', '#c94f47', 1, .18));
    } else if (key === 'knife') {
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-knife', { width: .035, height: .055, depth: .38 }, s), [0, 0, .08], accent);
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-knife-handle', { width: .07, height: .07, depth: .16 }, s), [0, 0, -.18]);
    } else if (key === 'pistol') {
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-pistol', { width: .09, height: .13, depth: .33 }, s), [0, .03, .05]);
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-pistol-grip', { width: .08, height: .19, depth: .09 }, s), [0, -.11, -.05]);
    } else {
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-rifle', { width: .09, height: .12, depth: .58 }, s), [0, .02, .08]);
      add(BABYLON.MeshBuilder.CreateBox('mf-vm-stock', { width: .10, height: .13, depth: .22 }, s), [0, -.01, -.32]);
      add(BABYLON.MeshBuilder.CreateCylinder('mf-vm-barrel', { height: .30, diameter: .035, tessellation: 8 }, s), [0, .01, .46], accent);
      const barrel = viewModelRoot.getChildren().find((x) => x.name === 'mf-vm-barrel');
      if (barrel) barrel.rotation.x = Math.PI / 2;
    }
  }

  function updateViewModel(frame) {
    const cam = window.matchframePov?.getCamera?.();
    const p = playerInFrame(frame, selectedPlayer);
    if (!cam || !p) return;
    const key = weaponKind(p.active_weapon_name);
    if (key !== viewModelKey || !viewModelRoot) buildViewModel(key);
    if (!viewModelRoot || key === 'none') return;

    const src = window.matchframePov.sourceForward(p.pitch, p.yaw);
    const forward = window.matchframePov.sourceDirectionToGltf(src.x, src.y, src.z).normalize();
    const up = new BABYLON.Vector3(0, 1, 0);
    let right = BABYLON.Vector3.Cross(up, forward).normalize();
    if (!right.lengthSquared()) right = new BABYLON.Vector3(1, 0, 0);
    const down = up.scale(-1);
    const pos = cam.position.add(forward.scale(.55)).add(right.scale(.22)).add(down.scale(.18));
    viewModelRoot.position.copyFrom(pos);
    try {
      viewModelRoot.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionRH(forward, up);
    } catch (_) {}
  }

  function updateWorld() {
    if (worldDisabledForScene || viewMode !== 'pov' || !window.matchframePov?.isReady?.()) return;
    const frame = nearestFrame(currentTick);
    if (!frame) return;
    try {
      updateActors(frame);
      updateBomb();
      updateUtilities();
      updateViewModel(frame);
    } catch (error) {
      // Overlay geometry is optional. Never let one unsupported Babylon primitive/material stop
      // the global playback requestAnimationFrame loop or take the renderer down with the map.
      worldDisabledForScene = true;
      const message = String(error?.stack || error?.message || error);
      if (message !== lastWorldError) {
        lastWorldError = message;
        console.error('[MatchFrame POV world overlay disabled]', error);
      }
    }
  }

  const previousUpdatePovCamera = updatePovCamera;
  updatePovCamera = function() {
    previousUpdatePovCamera();
    updateWorld();
  };

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    lastUtilityKey = '';
    previousLoadDemo(result);
  };
})();
