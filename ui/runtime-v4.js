(() => {
  let lastTeamSignature = '';

  function validPovState(state) {
    return Boolean(state && window.matchframePov?.isPlayerUsable?.(state));
  }

  function nearestUsablePlayerState(tick, player) {
    const frames = demo?.frames || [];
    if (!frames.length || !player) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(frames[mid].tick || 0) < tick) lo = mid + 1;
      else hi = mid;
    }
    for (let radius = 0; radius < Math.min(frames.length, 96); radius++) {
      for (const index of radius ? [lo - radius, lo + radius] : [lo]) {
        if (index < 0 || index >= frames.length) continue;
        const state = playerInFrame(frames[index], player);
        if (validPovState(state)) return state;
      }
    }
    return null;
  }

  updatePovCamera = function() {
    if (viewMode !== 'pov' || !window.matchframePov?.isReady()) return;
    const exact = window.matchframeExactState?.(selectedPlayer, currentTick) || null;
    let player = validPovState(exact) ? exact : null;
    if (!player) {
      const sampled = nearestFrame(currentTick);
      const sampledPlayer = playerInFrame(sampled, selectedPlayer);
      if (validPovState(sampledPlayer)) player = sampledPlayer;
    }
    if (!player) player = nearestUsablePlayerState(currentTick, selectedPlayer);
    if (player) window.matchframePov.setPlayer(player);
    updateSelectedHud(nearestFrame(currentTick));
  };

  function genericTeamName(name) {
    return !name || /^(t|terrorist|terrorists|ct|counter[- _]?terrorist|counter[- _]?terrorists|takımsız)$/i.test(String(name).trim());
  }

  function playerIdentity(player, index) {
    const raw = String(player?.team_name || '').trim();
    if (!genericTeamName(raw)) return `name:${raw}`;
    const finalSide = Number(player?.team_number || 0);
    if (finalSide === 2 || finalSide === 3) return `roster:${finalSide}`;
    return `unknown:${index}`;
  }

  function identityLabel(identity, members) {
    const named = members.map((p) => String(p?.team_name || '').trim()).find((name) => !genericTeamName(name));
    if (named) return named;
    if (identity === 'roster:2') return 'Takım 1';
    if (identity === 'roster:3') return 'Takım 2';
    return 'Takım';
  }

  function currentStateMap() {
    const map = new Map();
    const frame = nearestFrame(currentTick);
    for (const state of frame?.players || []) {
      const steamid = String(state.steamid || '');
      if (steamid) map.set(steamid, state);
    }
    return map;
  }

  function currentSideForMembers(members, stateMap) {
    const votes = new Map([[2, 0], [3, 0]]);
    for (const player of members) {
      const state = stateMap.get(String(player.steamid || ''));
      const side = Number(state?.team_num || 0);
      if (votes.has(side)) votes.set(side, votes.get(side) + 1);
    }
    if (votes.get(2) === votes.get(3)) {
      const fallback = Number(members[0]?.team_number || 0);
      return fallback === 2 || fallback === 3 ? fallback : 0;
    }
    return votes.get(2) > votes.get(3) ? 2 : 3;
  }

  function createRuntimePlayerRow(player, index) {
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

  function buildTeamGroups(players) {
    const grouped = new Map();
    (players || []).forEach((player, index) => {
      const id = playerIdentity(player, index);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(player);
    });
    const stateMap = currentStateMap();
    const groups = [...grouped.entries()].map(([id, members]) => ({
      id,
      members,
      label: identityLabel(id, members),
      side: currentSideForMembers(members, stateMap)
    }));
    groups.sort((a, b) => {
      const rank = (side) => side === 2 ? 0 : side === 3 ? 1 : 2;
      return rank(a.side) - rank(b.side) || a.label.localeCompare(b.label, 'tr');
    });
    return groups;
  }

  function teamSignature(groups) {
    return groups.map((group) => `${group.id}:${group.side}:${group.members.map((p) => p.steamid).join(',')}`).join('|');
  }

  function paintTeams(force = false) {
    if (!demo?.players?.length) return;
    const groups = buildTeamGroups(demo.players);
    const signature = teamSignature(groups);
    if (!force && signature === lastTeamSignature) return;
    lastTeamSignature = signature;

    const selectedSteam = String(selectedPlayer?.steamid || '');
    const list = $('playersList');
    list.innerHTML = '';
    $('playerCount').textContent = demo.players.length;
    selectedPlayerButton = null;
    let rowIndex = 0;

    for (const group of groups) {
      const section = document.createElement('section');
      section.className = `team-group ${group.side === 2 ? 'team-t' : group.side === 3 ? 'team-ct' : ''}`;
      const header = document.createElement('div');
      header.className = 'team-group-head';
      header.innerHTML = `<span class="team-dot"></span><span class="team-group-name"></span><span class="team-side"></span><span class="team-count"></span>`;
      header.querySelector('.team-group-name').textContent = group.label;
      header.querySelector('.team-side').textContent = group.side === 2 ? 'T' : group.side === 3 ? 'CT' : '—';
      header.querySelector('.team-count').textContent = String(group.members.length);
      section.appendChild(header);
      for (const player of group.members) {
        const row = createRuntimePlayerRow(player, rowIndex++);
        section.appendChild(row);
        if (selectedSteam && String(player.steamid || '') === selectedSteam) selectedPlayerButton = row;
      }
      list.appendChild(section);
    }
    if (selectedPlayerButton) selectedPlayerButton.classList.add('active');
  }

  renderPlayers = function(players) {
    if (!demo) return;
    demo.players = Array.isArray(players) ? players : [];
    paintTeams(true);
  };

  const previousUpdateTimeLabel = updateTimeLabel;
  updateTimeLabel = function() {
    previousUpdateTimeLabel();
    paintTeams(false);
  };

  const previousSelectPlayer = selectPlayer;
  selectPlayer = function(player, button) {
    previousSelectPlayer(player, button);
    if (button) selectedPlayerButton = button;
  };
})();
