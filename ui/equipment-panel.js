(() => {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  const style = document.createElement('style');
  style.textContent = `
    .radar-equip{position:absolute;z-index:11;left:12px;top:12px;width:270px;max-height:calc(100% - 24px);overflow:auto;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(8,8,10,.82);backdrop-filter:blur(10px);box-shadow:0 8px 28px rgba(0,0,0,.24);pointer-events:none;scrollbar-width:none}
    .radar-equip::-webkit-scrollbar{display:none}.radar-equip.hidden{display:none!important}
    .equip-team+.equip-team{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.065)}
    .equip-team-head{display:flex;align-items:center;gap:6px;height:20px;padding:0 2px 5px;font:650 9px "Segoe UI",sans-serif;text-transform:uppercase;letter-spacing:.05em}
    .equip-team.t .equip-team-head{color:#d2ad69}.equip-team.ct .equip-team-head{color:#79a7c7}.equip-team-count{margin-left:auto;font:8px Consolas,monospace;color:#6d6d75}
    .equip-player{display:grid;grid-template-columns:9px minmax(58px,1fr) minmax(88px,1.5fr) auto;align-items:center;gap:6px;min-height:28px;padding:4px 3px;border-radius:5px}.equip-player.dead{opacity:.38}.equip-player+.equip-player{border-top:1px solid rgba(255,255,255,.035)}
    .equip-color{width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.6)}.equip-name{min-width:0;font:600 9px "Segoe UI",sans-serif;color:#dddde2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .equip-loadout{min-width:0;display:flex;align-items:center;gap:4px;overflow:hidden}.equip-weapon{min-width:0;max-width:102px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 8px Consolas,monospace}.equip-team.t .equip-weapon{color:#d2ad69}.equip-team.ct .equip-weapon{color:#79a7c7}
    .equip-ammo{font:8px Consolas,monospace;color:#d6d6dc;white-space:nowrap}.equip-items{grid-column:3/5;display:flex;flex-wrap:wrap;gap:3px;margin-top:-1px;min-height:12px}.equip-chip{height:13px;display:inline-flex;align-items:center;padding:0 4px;border:1px solid rgba(255,255,255,.07);border-radius:3px;background:rgba(255,255,255,.035);font:7px Consolas,monospace;color:#8f8f98;white-space:nowrap}.equip-chip.util{color:#b7b7bf}.equip-chip.c4{color:#ff9f8e;border-color:rgba(255,105,86,.22)}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'radarEquipment';
  panel.className = 'radar-equip hidden';
  viewport.appendChild(panel);

  const PLAYER_COLORS = {
    blue: '#5d79ae', green: '#04b462', yellow: '#d5e800', orange: '#d58b00', purple: '#b25de5'
  };
  const UTIL_NAMES = new Map([
    ['flashbang', 'FLASH'], ['smokegrenade', 'SMOKE'], ['hegrenade', 'HE'], ['molotov', 'MOLOTOV'], ['incgrenade', 'INC'], ['decoy', 'DECOY'], ['c4', 'C4']
  ]);
  const IGNORE = new Set(['knife','knife_t','taser','healthshot']);
  let lastSignature = '';
  let lastPaint = 0;

  function cleanItem(value) {
    return String(value || '').toLowerCase().replace(/^weapon_/, '').replace(/^item_/, '').trim();
  }

  function flattenInventory(value, out = []) {
    if (value == null) return out;
    if (Array.isArray(value)) {
      for (const item of value) flattenInventory(item, out);
      return out;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) flattenInventory(item, out);
      return out;
    }
    if (typeof value === 'string') {
      const raw = cleanItem(value);
      if (raw) out.push(raw);
    }
    return out;
  }

  function countInventory(player) {
    const counts = new Map();
    for (const item of flattenInventory(player?.inventory)) counts.set(item, (counts.get(item) || 0) + 1);
    return counts;
  }

  function prettyWeapon(name) {
    const key = cleanItem(name);
    const aliases = {
      ak47:'AK-47', m4a1:'M4A4', m4a1_silencer:'M4A1-S', usp_silencer:'USP-S', hkp2000:'P2000',
      elite:'DUALIES', deagle:'DEAGLE', revolver:'R8', sg556:'SG 553', ssg08:'SSG 08', scar20:'SCAR-20',
      g3sg1:'G3SG1', mp5sd:'MP5-SD', mp9:'MP9', mac10:'MAC-10', mag7:'MAG-7', sawedoff:'SAWED-OFF',
      nova:'NOVA', xm1014:'XM1014', negev:'NEGEV', m249:'M249', cz75a:'CZ75', tec9:'TEC-9', fiveseven:'FIVE-SEVEN'
    };
    return aliases[key] || key.replace(/_/g, ' ').toUpperCase() || '—';
  }

  function teamLabel(members, teamNum) {
    for (const player of members) {
      const clan = String(player?.team_clan_name || '').trim();
      if (clan) return clan;
      const name = String(player?.team_name || '').trim();
      if (name && !/^(t|ct|terrorists?|counter[- _]?terrorists?)$/i.test(name)) return name;
    }
    return teamNum === 2 ? 'Terrorists' : 'Counter-Terrorists';
  }

  function ammoText(player) {
    const clip = Number(player?.active_weapon_ammo);
    const reserve = Number(player?.total_ammo_left);
    if (!Number.isFinite(clip) || clip < 0) return '';
    return Number.isFinite(reserve) && reserve >= 0 ? `${clip}/${reserve}` : String(clip);
  }

  function renderPlayer(player) {
    const row = document.createElement('div');
    row.className = `equip-player${player?.is_alive && Number(player?.health || 0) > 0 ? '' : ' dead'}`;
    const color = PLAYER_COLORS[String(player?.player_color || '').toLowerCase()] || '#8c8c94';
    const active = prettyWeapon(player?.active_weapon_name);
    const ammo = ammoText(player);
    row.innerHTML = `<span class="equip-color"></span><span class="equip-name"></span><span class="equip-loadout"><span class="equip-weapon"></span></span><span class="equip-ammo"></span><span class="equip-items"></span>`;
    row.querySelector('.equip-color').style.background = color;
    row.querySelector('.equip-name').textContent = player?.name || 'Player';
    row.querySelector('.equip-weapon').textContent = active;
    row.querySelector('.equip-ammo').textContent = ammo;

    const items = row.querySelector('.equip-items');
    const counts = countInventory(player);
    const activeKey = cleanItem(player?.active_weapon_name);
    for (const [key, count] of counts) {
      if (!key || key === activeKey || IGNORE.has(key)) continue;
      const chip = document.createElement('span');
      const utilName = UTIL_NAMES.get(key);
      chip.className = `equip-chip${utilName ? ' util' : ''}${key === 'c4' ? ' c4' : ''}`;
      chip.textContent = `${utilName || prettyWeapon(key)}${count > 1 ? `×${count}` : ''}`;
      items.appendChild(chip);
    }
    return row;
  }

  function frameSignature(frame) {
    return (frame?.players || []).map((p) => [p.steamid,p.team_num,p.player_color,p.is_alive,p.health,p.active_weapon_name,p.active_weapon_ammo,p.total_ammo_left,JSON.stringify(p.inventory)].join(':')).join('|');
  }

  function render(frame, force = false) {
    const shouldShow = viewMode === 'tactical' && demo && frame;
    panel.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;
    const now = performance.now();
    if (!force && now - lastPaint < 80) return;
    const signature = frameSignature(frame);
    if (!force && signature === lastSignature) return;
    lastPaint = now;
    lastSignature = signature;
    panel.innerHTML = '';

    for (const teamNum of [2, 3]) {
      const members = (frame.players || []).filter((player) => Number(player?.team_num) === teamNum);
      if (!members.length) continue;
      const section = document.createElement('section');
      section.className = `equip-team ${teamNum === 2 ? 't' : 'ct'}`;
      const head = document.createElement('div');
      head.className = 'equip-team-head';
      head.innerHTML = `<span class="equip-team-name"></span><span class="equip-team-count"></span>`;
      head.querySelector('.equip-team-name').textContent = `${teamLabel(members, teamNum)} · ${teamNum === 2 ? 'T' : 'CT'}`;
      head.querySelector('.equip-team-count').textContent = String(members.length);
      section.appendChild(head);
      for (const player of members) section.appendChild(renderPlayer(player));
      panel.appendChild(section);
    }
  }

  const previousLoadDemo = loadDemo;
  loadDemo = function(result) {
    lastSignature = '';
    previousLoadDemo(result);
    render(nearestFrame(currentTick), true);
  };

  const previousDraw = drawCurrentFrame;
  drawCurrentFrame = function() {
    previousDraw();
    render(nearestFrame(currentTick));
  };

  const previousSetViewMode = setViewMode;
  setViewMode = function(mode) {
    previousSetViewMode(mode);
    render(nearestFrame(currentTick), true);
  };
})();
