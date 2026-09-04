(() => {
  const cameraTrackBySteam = new Map();

  const style = document.createElement('style');
  style.textContent = `
    .console-panel:not(.open){visibility:hidden!important;opacity:0!important;pointer-events:none!important;box-shadow:none!important;transform:translateY(-120%)!important}
    .console-panel.open{visibility:visible!important;opacity:1!important;pointer-events:auto!important}
    .kill-feed{position:absolute;z-index:12;top:14px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:5px;pointer-events:none;max-width:min(46%,520px)}
    .kill-row{display:flex;align-items:center;gap:7px;min-height:28px;padding:5px 8px;border:1px solid rgba(255,255,255,.09);border-radius:6px;background:rgba(10,10,12,.84);backdrop-filter:blur(10px);font-size:10px;box-shadow:0 2px 12px rgba(0,0,0,.18)}
    .kill-row .attacker,.kill-row .victim{font-weight:650;color:#f1f1f3;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .kill-row .weapon{color:#a6a6ae;font:9px Consolas,monospace;text-transform:uppercase;letter-spacing:.03em}
    .kill-row .arrow{color:#66666d}
    .transport-btn.seek-30{min-width:54px}
  `;
  document.head.appendChild(style);

  const viewport = document.getElementById('viewport');
  const killFeed = document.createElement('div');
  killFeed.id = 'killFeed';
  killFeed.className = 'kill-feed';
  viewport?.appendChild(killFeed);

  function installSeekButtons() {
    const prevRound = document.getElementById('prevRound');
    const nextRound = document.getElementById('nextRound');
    if (!prevRound || !nextRound || document.getElementById('back30')) return;
    const back = document.createElement('button');
    back.id = 'back30';
    back.className = 'transport-btn seek-30';
    back.textContent = '−30 sn';
    back.title = '30 saniye geri';
    back.onclick = () => seek(currentTick - tickRate() * 30);
    prevRound.parentElement.insertBefore(back, prevRound);

    const forward = document.createElement('button');
    forward.id = 'forward30';
    forward.className = 'transport-btn seek-30';
    forward.textContent = '+30 sn';
    forward.title = '30 saniye ileri';
    forward.onclick = () => seek(currentTick + tickRate() * 30);
    nextRound.insertAdjacentElement('afterend', forward);
  }
  installSeekButtons();

  function rebuildCameraIndex() {
    cameraTrackBySteam.clear();
    for (const track of demo?.cameraTracks || []) {
      if (track?.steamid && track?.ticks && track?.values) cameraTrackBySteam.set(String(track.steamid), track);
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    let delta = ((b - a + 540) % 360) - 180;
    return a + delta * t;
  }

  function exactState(player, tick) {
    if (!player) return null;
    const track = cameraTrackBySteam.get(String(player.steamid || ''));
    if (!track || !track.ticks?.length) return null;
    const ticks = track.ticks;
    const values = track.values;
    const stride = Number(track.stride || 7);
    let lo = 0, hi = ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] < tick) lo = mid + 1; else hi = mid;
    }
    const upper = lo;
    const lower = upper > 0 ? upper - 1 : upper;
    const t0 = Number(ticks[lower]);
    const t1 = Number(ticks[upper]);
    const alpha = t1 > t0 ? Math.max(0, Math.min(1, (tick - t0) / (t1 - t0))) : 0;
    const a = lower * stride;
    const b = upper * stride;
    return {
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
  }

  window.matchframeExactState = exactState;

  const originalLoadDemo = loadDemo;
  loadDemo = function(result) {
    originalLoadDemo(result);
    rebuildCameraIndex();
    if (result.cameraError) log(`Exact usercmd camera fallback: ${result.cameraError}`, 'system');
    drawCurrentFrame();
  };

  // Replace coarse nearest-frame position/angle values with exact per-tick camera tracks.
  // Discrete state (HP, team, alive, weapon) still comes from the sampled frame.
  const originalNearestFrame = nearestFrame;
  nearestFrame = function(tick) {
    const frame = originalNearestFrame(tick);
    if (!frame || !cameraTrackBySteam.size) return frame;
    return {
      ...frame,
      tick,
      players: frame.players.map((player) => {
        const exact = exactState(player, tick);
        return exact ? { ...player, ...exact } : player;
      })
    };
  };

  function eventName(event, role) {
    return String(event?.[`${role}_name`] || event?.[`${role}_player_name`] || event?.[role] || '?');
  }

  function weaponName(event) {
    return String(event?.weapon || event?.weapon_name || '?')
      .replace(/^weapon_/i, '')
      .replace(/_/g, ' ');
  }

  function renderKillFeed() {
    if (!killFeed || !demo) return;
    const windowTicks = tickRate() * 7;
    const rows = (demo.deaths || [])
      .filter((event) => {
        const t = Number(event.tick || 0);
        return t <= currentTick && currentTick - t <= windowTicks;
      })
      .slice(-5)
      .reverse();
    killFeed.innerHTML = '';
    for (const event of rows) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      const attacker = document.createElement('span'); attacker.className = 'attacker'; attacker.textContent = eventName(event, 'attacker');
      const weapon = document.createElement('span'); weapon.className = 'weapon'; weapon.textContent = weaponName(event);
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
      const victim = document.createElement('span'); victim.className = 'victim'; victim.textContent = eventName(event, 'user');
      row.append(attacker, weapon, arrow, victim);
      killFeed.appendChild(row);
    }
  }

  const originalUpdateTimeLabel = updateTimeLabel;
  updateTimeLabel = function() {
    originalUpdateTimeLabel();
    renderKillFeed();
  };

  const originalDrawCurrentFrame = drawCurrentFrame;
  drawCurrentFrame = function() {
    originalDrawCurrentFrame();
    renderKillFeed();
  };

  // POV uses exact tick data (usercmd view angles where available) and interpolates between
  // demo ticks, allowing the renderer to present up to the display's refresh rate (120 Hz+).
  updatePovCamera = function() {
    if (viewMode !== 'pov' || !window.matchframePov?.isReady()) return;
    const sampled = originalNearestFrame(currentTick);
    const base = playerInFrame(sampled, selectedPlayer) || selectedPlayer;
    const exact = exactState(selectedPlayer, currentTick);
    const player = exact ? { ...base, ...exact } : base;
    if (player) window.matchframePov.setPlayer(player);
    updateSelectedHud(nearestFrame(currentTick));
    renderKillFeed();
  };

  document.addEventListener('keydown', (event) => {
    if (consoleOpen) return;
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      seek(currentTick - tickRate() * 30);
    } else if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      seek(currentTick + tickRate() * 30);
    }
  });
})();
