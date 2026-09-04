(() => {
  const cameraTrackBySteam = new Map();
  let lastKillSignature = '';
  let lastTransportPaint = 0;
  let lastHudPaint = 0;

  const style = document.createElement('style');
  style.textContent = `
    .console-panel:not(.open){visibility:hidden!important;opacity:0!important;pointer-events:none!important;box-shadow:none!important;transform:translateY(-120%)!important}
    .console-panel.open{visibility:visible!important;opacity:1!important;pointer-events:auto!important}
    .team-group{padding:5px 5px 8px}.team-group+.team-group{border-top:1px solid rgba(255,255,255,.06);padding-top:9px}.team-group-head{height:28px;display:flex;align-items:center;gap:7px;padding:0 5px;color:#b9b9c0}.team-group-head .team-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}.team-group.team-t .team-dot{background:#d2ad69}.team-group.team-ct .team-dot{background:#79a7c7}.team-group-name{min-width:0;flex:1;font-size:10px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.team-side{font:8px Consolas,monospace;color:#6f6f77;border:1px solid #2b2b31;border-radius:999px;padding:2px 5px}.team-count{font:8px Consolas,monospace;color:#67676f}.team-group .player{padding-left:6px}
    .kill-feed{position:absolute;z-index:12;top:14px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:5px;pointer-events:none;max-width:min(62%,720px)}
    .kill-row{display:flex;align-items:center;gap:7px;min-height:31px;padding:5px 8px;border:1px solid rgba(255,255,255,.09);border-radius:6px;background:rgba(10,10,12,.86);backdrop-filter:blur(10px);font-size:10px;box-shadow:0 2px 12px rgba(0,0,0,.18)}
    .kill-row .attacker,.kill-row .victim{font-weight:650;color:#f1f1f3;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kill-row .victim{color:#d5d5da}
    .weapon-icon-wrap{width:42px;height:18px;display:flex;align-items:center;justify-content:center;flex:0 0 42px}.weapon-icon{display:block;max-width:42px;max-height:18px;object-fit:contain;filter:grayscale(1) brightness(1.65);opacity:.94}.weapon-fallback{font-size:14px;color:#a8a8af}
    .kill-mods{display:flex;gap:3px;align-items:center}.kill-mod{height:17px;display:flex;align-items:center;padding:0 4px;border-radius:4px;background:#222227;border:1px solid rgba(255,255,255,.07);font:7px Consolas,monospace;color:#a9a9b0;white-space:nowrap}.kill-mod.hs{color:#d9b6a1}.kill-mod.smoke{color:#b4b8bd}.kill-mod.jump{color:#b9c8d4}.kill-mod.scope{color:#c5b7d4}.kill-mod.blind{color:#d7d5b5}
    .kill-assist{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;color:#8d8d96;padding-left:2px}.kill-assist strong{font-weight:600;color:#b2b2b9}.kill-arrow{color:#66666d}
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

  function playerTeamNum(player) {
    const n = Number(player?.team_number ?? player?.team_num ?? 0);
    return n === 2 || n === 3 ? n : 0;
  }

  function fallbackTeamName(teamNum) {
    return teamNum === 2 ? 'Terrorists' : teamNum === 3 ? 'Counter-Terrorists' : 'Takımsız';
  }

  function cleanTeamLabel(player, teamNum) {
    const name = String(player?.team_name || '').trim();
    if (!name || /^(t|terrorist|terrorists|ct|counter[- _]?terrorist|counter[- _]?terrorists)$/i.test(name)) return fallbackTeamName(teamNum);
    return name;
  }

  function createPlayerRow(player, index) {
    const row = document.createElement('button');
    row.className = 'player';
    row.type = 'button';
    const steamid = String(player.steamid || '');
    row.dataset.steamid = steamid;
    row.innerHTML = `<span class="avatar neutral"></span><span class="ptext"><span class="pname"></span><span class="pmeta"></span></span><span class="voice-slot"></span>`;
    row.querySelector('.avatar').textContent = playerInitial(player.name, index);
    row.querySelector('.pname').textContent = player.name || `Player ${index + 1}`;
    row.querySelector('.pmeta').textContent = steamid || 'Unknown SteamID';
    const voice = voiceTracks.get(steamid);
    if (voice) {
      const voiceButton = document.createElement('button');
      voiceButton.className = `voice-toggle${voice.enabled ? ' active' : ''}`;
      voiceButton.type = 'button';
      voiceButton.title = voice.enabled ? 'Oyun içi sesi kapat' : 'Oyun içi sesi aç';
      voiceButton.textContent = voice.enabled ? 'Ses açık' : 'Ses';
      voiceButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        voice.enabled = !voice.enabled;
        voiceButton.classList.toggle('active', voice.enabled);
        voiceButton.textContent = voice.enabled ? 'Ses açık' : 'Ses';
        voiceButton.title = voice.enabled ? 'Oyun içi sesi kapat' : 'Oyun içi sesi aç';
        syncVoice(true);
      };
      row.querySelector('.voice-slot').appendChild(voiceButton);
    }
    row.onclick = () => selectPlayer(player, row);
    return row;
  }

  renderPlayers = function(players) {
    const list = Array.isArray(players) ? players : [];
    const selectedSteam = String(selectedPlayer?.steamid || '');
    const grouped = new Map([[2, []], [3, []]]);
    for (const player of list) {
      const teamNum = playerTeamNum(player);
      if (grouped.has(teamNum)) grouped.get(teamNum).push(player);
    }
    const shownCount = grouped.get(2).length + grouped.get(3).length;
    $('playerCount').textContent = shownCount || list.length;
    $('playersList').innerHTML = '';
    selectedPlayerButton = null;

    let runningIndex = 0;
    for (const teamNum of [2, 3]) {
      const members = grouped.get(teamNum);
      if (!members.length) continue;
      const section = document.createElement('section');
      section.className = `team-group ${teamNum === 2 ? 'team-t' : 'team-ct'}`;
      const header = document.createElement('div');
      header.className = 'team-group-head';
      const label = members.map((p) => cleanTeamLabel(p, teamNum)).find((name) => name !== fallbackTeamName(teamNum)) || cleanTeamLabel(members[0], teamNum);
      header.innerHTML = `<span class="team-dot"></span><span class="team-group-name"></span><span class="team-side"></span><span class="team-count"></span>`;
      header.querySelector('.team-group-name').textContent = label;
      header.querySelector('.team-side').textContent = teamNum === 2 ? 'T' : 'CT';
      header.querySelector('.team-count').textContent = String(members.length);
      section.appendChild(header);
      for (const player of members) {
        const row = createPlayerRow(player, runningIndex++);
        section.appendChild(row);
        if (selectedSteam && String(player.steamid || '') === selectedSteam) selectedPlayerButton = row;
      }
      $('playersList').appendChild(section);
    }

    if (!shownCount && list.length) {
      for (const player of list) $('playersList').appendChild(createPlayerRow(player, runningIndex++));
    }
    if (selectedPlayerButton) selectedPlayerButton.classList.add('active');
  };

  selectDefaultPlayer = function(players) {
    if (!players?.length) return;
    const preferred = players.find((p) => /pifo/i.test(String(p.name || ''))) || players.find((p) => playerTeamNum(p)) || players[0];
    const steamid = String(preferred.steamid || '');
    const row = [...document.querySelectorAll('.player')].find((el) => String(el.dataset.steamid || '') === steamid) || document.querySelector('.player');
    selectPlayer(preferred, row || null);
  };

  function rebuildCameraIndex() {
    cameraTrackBySteam.clear();
    for (const track of demo?.cameraTracks || []) {
      if (track?.steamid && track?.ticks && track?.values) cameraTrackBySteam.set(String(track.steamid), track);
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    const delta = ((b - a + 540) % 360) - 180;
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

  drawVision = function(x, y, yaw, length) {
    const a = -Number(yaw || 0) * Math.PI / 180;
    const spread = 32 * Math.PI / 180;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, length);
    grad.addColorStop(0, 'rgba(240,240,242,.12)');
    grad.addColorStop(1, 'rgba(240,240,242,0)');
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, length, a - spread, a + spread);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  };

  function eventName(event, role) {
    return String(event?.[`${role}_name`] || event?.[`${role}_player_name`] || event?.[role] || '?');
  }

  function eventTruthy(value) {
    if (value === true || value === 1 || value === '1') return true;
    return String(value || '').toLowerCase() === 'true';
  }

  function weaponKey(event) {
    let key = String(event?.weapon || event?.weapon_name || '').toLowerCase().replace(/^weapon_/, '').replace(/[^a-z0-9_]/g, '');
    const aliases = {
      m4a1_silencer_off: 'm4a1_silencer',
      usp_silencer_off: 'usp_silencer',
      knife_t: 'knife',
      molotov_projectile: 'molotov',
      hegrenade_projectile: 'hegrenade',
      flashbang_projectile: 'flashbang',
      smokegrenade_projectile: 'smokegrenade'
    };
    return aliases[key] || key || 'knife';
  }

  function weaponIcon(event) {
    const wrap = document.createElement('span');
    wrap.className = 'weapon-icon-wrap';
    const img = document.createElement('img');
    const key = weaponKey(event);
    img.className = 'weapon-icon';
    img.alt = '';
    img.title = String(event?.weapon || event?.weapon_name || key);
    img.src = `https://raw.githubusercontent.com/Juknum/counter-strike-icons/main/cs2/panorama/images/icons/equipment/${encodeURIComponent(key)}.svg`;
    img.onerror = () => {
      if (!img.dataset.fallback && key.startsWith('knife') && key !== 'knife') {
        img.dataset.fallback = '1';
        img.src = 'https://raw.githubusercontent.com/Juknum/counter-strike-icons/main/cs2/panorama/images/icons/equipment/knife.svg';
        return;
      }
      const fallback = document.createElement('span');
      fallback.className = 'weapon-fallback';
      fallback.textContent = '•';
      fallback.title = img.title;
      img.replaceWith(fallback);
    };
    wrap.appendChild(img);
    return wrap;
  }

  function addModifier(container, text, className, title) {
    const badge = document.createElement('span');
    badge.className = `kill-mod ${className}`;
    badge.textContent = text;
    badge.title = title;
    container.appendChild(badge);
  }

  function renderKillFeed(force = false) {
    if (!killFeed || !demo) return;
    const windowTicks = tickRate() * 7;
    const rows = (demo.deaths || [])
      .filter((event) => {
        const t = Number(event.tick || 0);
        return t <= currentTick && currentTick - t <= windowTicks;
      })
      .slice(-5)
      .reverse();
    const signature = rows.map((event) => [event.tick, eventName(event, 'attacker'), eventName(event, 'user'), event.weapon, event.headshot, event.thrusmoke, event.attackerinair, event.noscope, event.attackerblind, event.assister_name, event.assister_player_name].join(':')).join('|');
    if (!force && signature === lastKillSignature) return;
    lastKillSignature = signature;
    killFeed.innerHTML = '';

    for (const event of rows) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      const attacker = document.createElement('span');
      attacker.className = 'attacker';
      attacker.textContent = eventName(event, 'attacker');
      const victim = document.createElement('span');
      victim.className = 'victim';
      victim.textContent = eventName(event, 'user');
      const arrow = document.createElement('span');
      arrow.className = 'kill-arrow';
      arrow.textContent = '→';
      const mods = document.createElement('span');
      mods.className = 'kill-mods';
      if (eventTruthy(event.headshot)) addModifier(mods, 'HS', 'hs', 'Kafadan vuruş');
      if (eventTruthy(event.thrusmoke)) addModifier(mods, 'SMOKE', 'smoke', 'Smoke arkasından vuruş');
      if (eventTruthy(event.attackerinair)) addModifier(mods, 'JUMP', 'jump', 'Havadayken vuruş');
      if (eventTruthy(event.noscope)) addModifier(mods, 'NO SCOPE', 'scope', 'No-scope vuruş');
      if (eventTruthy(event.attackerblind)) addModifier(mods, 'BLIND', 'blind', 'Körken vuruş');

      row.append(attacker, weaponIcon(event));
      if (mods.childElementCount) row.appendChild(mods);
      row.append(arrow, victim);

      const assister = String(event?.assister_name || event?.assister_player_name || '').trim();
      if (assister && assister !== '?' && assister !== '0') {
        const assist = document.createElement('span');
        assist.className = 'kill-assist';
        const kind = eventTruthy(event.assistedflash) ? 'flash assist' : 'assist';
        assist.innerHTML = `${kind}: <strong></strong>`;
        assist.querySelector('strong').textContent = assister;
        row.appendChild(assist);
      }
      killFeed.appendChild(row);
    }
  }

  const originalUpdateTimeLabel = updateTimeLabel;
  updateTimeLabel = function() {
    const now = performance.now();
    if (playing && now - lastTransportPaint < 32) return;
    lastTransportPaint = now;
    originalUpdateTimeLabel();
    renderKillFeed();
  };

  const originalUpdateSelectedHud = updateSelectedHud;
  updateSelectedHud = function(frame = nearestFrame(currentTick)) {
    const now = performance.now();
    if (playing && now - lastHudPaint < 32) return;
    lastHudPaint = now;
    originalUpdateSelectedHud(frame);
  };

  const originalLoadDemo = loadDemo;
  loadDemo = function(result) {
    lastKillSignature = '';
    originalLoadDemo(result);
    rebuildCameraIndex();
    if (result.cameraError) log(`Exact usercmd camera fallback: ${result.cameraError}`, 'system');
    renderKillFeed(true);
    drawCurrentFrame();
  };

  // POV uses exact tick data and interpolates between demo ticks. Rendering itself stays on
  // requestAnimationFrame, so 120/144 Hz displays are not artificially capped by UI updates.
  updatePovCamera = function() {
    if (viewMode !== 'pov' || !window.matchframePov?.isReady()) return;
    const sampled = originalNearestFrame(currentTick);
    const base = playerInFrame(sampled, selectedPlayer) || selectedPlayer;
    const exact = exactState(selectedPlayer, currentTick);
    const player = exact ? { ...base, ...exact } : base;
    if (player) window.matchframePov.setPlayer(player);
    updateSelectedHud(nearestFrame(currentTick));
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
