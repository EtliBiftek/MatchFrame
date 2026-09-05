(() => {
  const MAX_TRACK_GAP_TICKS = 8;
  const MAX_SAMPLE_DELTA_UNITS = 192;
  let indexedDemo = null;
  let trackBySteam = new Map();
  let lastStableState = null;
  let lastSelectedSteam = '';
  let contextLost = false;

  // VRF currently has an open glTF export bug where vertex colours can make some CS2 map
  // materials render strongly red / partially transparent. The exported base textures are still
  // useful, so keep those and ignore the problematic per-vertex tint/alpha in the offline POV.
  if (window.BABYLON?.SceneLoader?.AppendAsync && !window.BABYLON.SceneLoader.__matchframeStableAppend) {
    const originalAppend = window.BABYLON.SceneLoader.AppendAsync.bind(window.BABYLON.SceneLoader);
    const wrappedAppend = async (...args) => {
      const targetScene = args[2] || null;
      const result = await originalAppend(...args);
      const loadedScene = targetScene || result;
      for (const mesh of loadedScene?.meshes || []) {
        try {
          if (mesh.isVerticesDataPresent?.(BABYLON.VertexBuffer.ColorKind)) {
            mesh.useVertexColors = false;
            mesh.hasVertexAlpha = false;
          }
        } catch (_) {}
      }
      return result;
    };
    wrappedAppend.__matchframeStableAppend = true;
    window.BABYLON.SceneLoader.AppendAsync = wrappedAppend;
  }

  function rebuildTrackIndex() {
    if (indexedDemo === demo) return;
    indexedDemo = demo;
    trackBySteam = new Map();
    for (const track of demo?.cameraTracks || []) {
      const steamid = String(track?.steamid || '');
      if (steamid && track?.ticks?.length && track?.values?.length) trackBySteam.set(steamid, track);
    }
    lastStableState = null;
    lastSelectedSteam = '';
  }

  function rawNearestFrame(tick) {
    const frames = demo?.frames || [];
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(frames[mid]?.tick || 0) < tick) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return frames[0];
    const a = frames[lo - 1], b = frames[lo];
    return Math.abs(Number(a.tick) - tick) <= Math.abs(Number(b.tick) - tick) ? a : b;
  }

  function rawPlayer(frame, player) {
    if (!frame || !player) return null;
    const steamid = String(player.steamid || '');
    const name = String(player.name || '');
    return (frame.players || []).find((state) =>
      (steamid && String(state.steamid || '') === steamid) || (!steamid && String(state.name || '') === name)
    ) || null;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    const delta = ((b - a + 540) % 360) - 180;
    return a + delta * t;
  }

  function robustExactState(player, tick) {
    rebuildTrackIndex();
    if (!player) return null;
    const track = trackBySteam.get(String(player.steamid || ''));
    if (!track?.ticks?.length) return null;
    const ticks = track.ticks;
    const values = track.values;
    const stride = Number(track.stride || 7);

    let lo = 0, hi = ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(ticks[mid]) < tick) lo = mid + 1;
      else hi = mid;
    }
    const upper = lo;
    const lower = upper > 0 ? upper - 1 : upper;
    const t0 = Number(ticks[lower]);
    const t1 = Number(ticks[upper]);
    const gap = Math.max(0, t1 - t0);

    // Never interpolate through a death/respawn, round transition or parser hole. That was the
    // main reason the camera could travel through the map and eventually end up looking at void.
    let chosenLower = lower;
    let chosenUpper = upper;
    let alpha = 0;
    if (gap > 0 && gap <= MAX_TRACK_GAP_TICKS) {
      alpha = Math.max(0, Math.min(1, (tick - t0) / gap));
    } else if (gap > MAX_TRACK_GAP_TICKS) {
      const d0 = Math.abs(tick - t0);
      const d1 = Math.abs(t1 - tick);
      const nearest = d0 <= d1 ? lower : upper;
      if (Math.min(d0, d1) > 2) return null;
      chosenLower = chosenUpper = nearest;
    }

    const a = chosenLower * stride;
    const b = chosenUpper * stride;
    const state = {
      steamid: String(player.steamid || ''),
      name: player.name || track.name || '',
      X: lerp(Number(values[a]), Number(values[b]), alpha),
      Y: lerp(Number(values[a + 1]), Number(values[b + 1]), alpha),
      Z: lerp(Number(values[a + 2]), Number(values[b + 2]), alpha),
      pitch: lerpAngle(Number(values[a + 3]), Number(values[b + 3]), alpha),
      yaw: lerpAngle(Number(values[a + 4]), Number(values[b + 4]), alpha),
      fov: lerp(Number(values[a + 5]), Number(values[b + 5]), alpha),
      duck_amount: lerp(Number(values[a + 6]), Number(values[b + 6]), alpha)
    };
    return [state.X, state.Y, state.Z, state.pitch, state.yaw].every(Number.isFinite) ? state : null;
  }

  function distance3(a, b) {
    if (!a || !b) return Infinity;
    const dx = Number(a.X) - Number(b.X);
    const dy = Number(a.Y) - Number(b.Y);
    const dz = Number(a.Z) - Number(b.Z);
    return Math.hypot(dx, dy, dz);
  }

  function usable(state) {
    return Boolean(state && window.matchframePov?.isPlayerUsable?.(state));
  }

  // Replace the older exact-state accessor so POV users do not get interpolation across long gaps.
  window.matchframeExactState = robustExactState;

  updatePovCamera = function() {
    if (viewMode !== 'pov' || !window.matchframePov?.isReady?.()) return;
    rebuildTrackIndex();

    const steamid = String(selectedPlayer?.steamid || '');
    if (steamid !== lastSelectedSteam) {
      lastSelectedSteam = steamid;
      lastStableState = null;
    }

    const rawFrame = rawNearestFrame(currentTick);
    const sampled = rawPlayer(rawFrame, selectedPlayer);

    // Demo pawn coordinates are not a spectator camera after death. Freeze the last valid POV
    // instead of following dead/respawning pawn data through world geometry.
    if (!sampled || sampled.is_alive === false || Number(sampled.health || 0) <= 0) {
      if (lastStableState && usable(lastStableState)) window.matchframePov.setPlayer(lastStableState);
      updateSelectedHud(rawFrame);
      return;
    }

    const exact = robustExactState(selectedPlayer, currentTick);
    let state = null;
    if (usable(exact) && distance3(exact, sampled) <= MAX_SAMPLE_DELTA_UNITS) state = { ...sampled, ...exact };
    else if (usable(sampled)) state = sampled;

    if (state) {
      lastStableState = { ...state };
      window.matchframePov.setPlayer(state);
    } else if (lastStableState && usable(lastStableState)) {
      window.matchframePov.setPlayer(lastStableState);
    }
    updateSelectedHud(rawFrame);
  };

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    indexedDemo = null;
    trackBySteam = new Map();
    lastStableState = null;
    lastSelectedSteam = '';
    previousLoadDemo(result);
  };

  const povCanvas = document.getElementById('povCanvas');
  if (povCanvas) {
    povCanvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      contextLost = true;
      const label = document.getElementById('viewerLabel');
      if (label) label.textContent = 'POV GPU context yeniden hazırlanıyor…';
    }, false);
    povCanvas.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      window.matchframePov?.resize?.();
      requestAnimationFrame(() => updatePovCamera());
    }, false);
  }

  window.addEventListener('matchframe:pov-restored', () => {
    contextLost = false;
    window.matchframePov?.resize?.();
    requestAnimationFrame(() => updatePovCamera());
  });

  // A lightweight watchdog covers Electron/GPU resize/context edge cases without rebuilding the map.
  setInterval(() => {
    if (contextLost || viewMode !== 'pov' || !window.matchframePov?.isReady?.()) return;
    const canvas = document.getElementById('povCanvas');
    if (!canvas || canvas.classList.contains('hidden')) return;
    const diagnostics = window.matchframePov?.diagnostics?.();
    if (!diagnostics || diagnostics.renderWidth <= 1 || diagnostics.renderHeight <= 1) window.matchframePov.resize();
  }, 1000);
})();
