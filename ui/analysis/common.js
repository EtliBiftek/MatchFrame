/*
 * MatchFrame — ortak analiz yardımcıları (saf fonksiyonlar)
 *
 * Bu dosya DOM'a veya Electron'a dokunmaz; yalnızca demoparser2 eventlerini
 * normalize eden ve temel matematik yapan fonksiyonlar içerir.
 * Node altında `require('../ui/analysis/common.js')` ile test edilebilir.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const ns = (root.MF = root.MF || {});
  ns.analysis = Object.assign(ns.analysis || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIDE_BY_TEAM_NUMBER = { 2: 'T', 3: 'CT' };
  const TEAM_NUMBER_BY_SIDE = { T: 2, CT: 3 };

  const WEAPON_LABELS = {
    ak47: 'AK-47',
    m4a1: 'M4A4',
    m4a1_silencer: 'M4A1-S',
    m4a1_silencer_off: 'M4A1-S',
    awp: 'AWP',
    ssg08: 'SSG 08',
    scar20: 'SCAR-20',
    g3sg1: 'G3SG1',
    aug: 'AUG',
    sg556: 'SG 553',
    famas: 'FAMAS',
    galilar: 'Galil AR',
    mp9: 'MP9',
    mac10: 'MAC-10',
    mp7: 'MP7',
    mp5sd: 'MP5-SD',
    ump45: 'UMP-45',
    p90: 'P90',
    bizon: 'PP-Bizon',
    nova: 'Nova',
    xm1014: 'XM1014',
    mag7: 'MAG-7',
    sawedoff: 'Sawed-Off',
    glock: 'Glock-18',
    usp_silencer: 'USP-S',
    usp_silencer_off: 'USP-S',
    hkp2000: 'P2000',
    p250: 'P250',
    fiveseven: 'Five-SeveN',
    tec9: 'Tec-9',
    cz75a: 'CZ75-Auto',
    deagle: 'Desert Eagle',
    revolver: 'R8 Revolver',
    elite: 'Dual Berettas',
    taser: 'Zeus x27',
    knife: 'Bıçak',
    knife_t: 'Bıçak',
    knife_ct: 'Bıçak',
    knife_karam: 'Bıçak',
    bayonet: 'Bıçak',
    hegrenade: 'HE',
    flashbang: 'Flash',
    smokegrenade: 'Smoke',
    molotov: 'Molotov',
    incgrenade: 'Molotov',
    inferno: 'Molotov',
    decoy: 'Decoy',
    c4: 'C4',
    world: 'Dünya',
    worldspawn: 'Dünya',
    trigger_hurt: 'Dünya',
    planted_c4: 'C4',
    env_explosion: 'Patlama',
    inferno_flame: 'Molotov',
    func_bomb_target: 'Bomba',
    bomb: 'Bomba'
  };

  const NON_PLAYER_WEAPONS = new Set(['world', 'worldspawn', 'trigger_hurt', 'env_explosion', 'func_bomb_target', 'planted_c4', 'bomb']);

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function str(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function bool(value) {
    if (value === true) return true;
    if (value === 1) return true;
    const text = String(value ?? '').trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'yes';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeDiv(numerator, denominator, fallback = 0) {
    const a = Number(numerator) || 0;
    const b = Number(denominator) || 0;
    if (!b) return fallback;
    return a / b;
  }

  function percent(numerator, denominator, digits = 1) {
    const value = safeDiv(numerator, denominator, 0) * 100;
    return Number(value.toFixed(digits));
  }

  function normalizeSteamId(value) {
    const text = str(value);
    if (!text || text === '0' || text === 'undefined') return '';
    return text;
  }

  function firstValue(source, keys) {
    if (!source) return null;
    for (const key of keys) {
      const value = source[key];
      if (value === null || value === undefined || value === '') continue;
      return value;
    }
    return null;
  }

  function firstText(source, keys) {
    const value = firstValue(source, keys);
    const text = str(value);
    return text && text !== '0' ? text : '';
  }

  function firstNumber(source, keys) {
    for (const key of keys) {
      const value = num(source?.[key]);
      if (value !== null) return value;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Veri bulunabilirliği (dataset status)
   * ------------------------------------------------------------------ */

  function makeDataset(rows, error) {
    if (error) return { available: false, error: String(error), count: 0, rows: [] };
    const list = Array.isArray(rows) ? rows : [];
    return { available: true, error: null, count: list.length, rows: list };
  }

  function missingDataset(error) {
    return { available: false, error: String(error || 'veri yok'), count: 0, rows: [] };
  }

  function emptyDataset() {
    return { available: true, error: null, count: 0, rows: [] };
  }

  function isAvailable(dataset) {
    return Boolean(dataset && dataset.available);
  }

  /* ------------------------------------------------------------------ *
   * Silah normalizasyonu
   * ------------------------------------------------------------------ */

  function normalizeWeapon(value) {
    let key = str(value).toLowerCase().replace(/\s+/g, '');
    if (!key) return { key: 'unknown', label: 'Bilinmiyor', raw: '' };
    key = key.replace(/^weapon_/, '').replace(/_projectile$/, '');
    const aliases = {
      m4a1_silencer_off: 'm4a1_silencer',
      usp_silencer_off: 'usp_silencer',
      knife_t: 'knife',
      knife_ct: 'knife',
      knife_css: 'knife',
      molotov_projectile: 'molotov',
      incgrenade: 'molotov',
      inferno: 'molotov',
      hegrenade_projectile: 'hegrenade',
      flashbang_projectile: 'flashbang',
      smokegrenade_projectile: 'smokegrenade',
      decoy_projectile: 'decoy',
      sg556: 'sg556',
      scar20: 'scar20',
      ssg08: 'ssg08',
      elite: 'elite',
      revolver: 'revolver'
    };
    if (aliases[key]) key = aliases[key];
    const label = WEAPON_LABELS[key] || key.toUpperCase();
    return { key, label, raw: str(value) };
  }

  function isNonPlayerWeapon(weaponKey) {
    return NON_PLAYER_WEAPONS.has(String(weaponKey || '').toLowerCase());
  }

  /* Utility (nade) hasarı veren silahlar: HE, molotov/inferno, decoy, flashbang. */
  const UTILITY_DAMAGE_WEAPON_KEYS = new Set(['hegrenade', 'he', 'molotov', 'inferno', 'incgrenade', 'firebomb', 'decoy', 'flashbang']);

  function utilityDamageKind(weapon) {
    const key = normalizeWeapon(weapon).key;
    if (key === 'hegrenade' || key === 'he') return 'he';
    if (key === 'molotov' || key === 'inferno' || key === 'incgrenade' || key === 'firebomb') return 'molotov';
    if (key === 'decoy') return 'decoy';
    if (key === 'flashbang') return 'flash';
    return null;
  }

  function isUtilityWeapon(weapon) {
    return utilityDamageKind(weapon) != null || UTILITY_DAMAGE_WEAPON_KEYS.has(normalizeWeapon(weapon).key);
  }

  /*
   * Bir utility event'i "atış" sayılır mı?
   * smoke/flash/he -> detonate, molotov/decoy -> start (inferno_startburn / decoy_started).
   * expire/fade olayları süre ölçümü için kullanılır, atış sayısına girmez.
   */
  function isUtilityThrowEvent(event) {
    const kind = event?.kind;
    const phase = event?.phase;
    if (!kind) return false;
    if (kind === 'molotov' || kind === 'decoy') return phase === 'start';
    return phase === 'detonate';
  }

  /* Atış event'ini kapatan bitiş event'i mi? (smokegrenade_expired / inferno_expire) */
  function isUtilityEndEvent(event) {
    return event?.phase === 'expire' && (event?.kind === 'smoke' || event?.kind === 'molotov');
  }

  /* ------------------------------------------------------------------ *
   * Uzay / geometri
   * ------------------------------------------------------------------ */

  function positionFrom(source, keys = { x: ['X'], y: ['Y'], z: ['Z'] }) {
    if (!source) return null;
    const x = firstNumber(source, keys.x);
    const y = firstNumber(source, keys.y);
    if (x === null || y === null) return null;
    const z = firstNumber(source, keys.z) ?? 0;
    return { x, y, z };
  }

  function prefixedPosition(source, prefix) {
    if (!source) return null;
    return positionFrom(source, {
      x: [`${prefix}_X`, `${prefix}_x`],
      y: [`${prefix}_Y`, `${prefix}_y`],
      z: [`${prefix}_Z`, `${prefix}_z`]
    });
  }

  function eventPosition(event) {
    return (
      positionFrom(event) ||
      prefixedPosition(event, 'user') ||
      prefixedPosition(event, 'player') ||
      null
    );
  }

  function distance3(a, b) {
    if (!a || !b) return null;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    const dz = (Number(a.z) || 0) - (Number(b.z) || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function distance2(a, b) {
    if (!a || !b) return null;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ------------------------------------------------------------------ *
   * Round eşleştirme
   * ------------------------------------------------------------------ */

  function sortByTick(list) {
    return [...(list || [])].sort((a, b) => (Number(a?.tick) || 0) - (Number(b?.tick) || 0));
  }

  function roundIndexForTick(rounds, tick) {
    const list = Array.isArray(rounds) ? rounds : [];
    if (!list.length) return -1;
    const value = Number(tick) || 0;
    let lo = 0;
    let hi = list.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = Number(list[mid].startTick) || 0;
      if (start <= value) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  function roundNumberForTick(rounds, tick) {
    const index = roundIndexForTick(rounds, tick);
    if (index < 0) return null;
    return Number(rounds[index].number ?? index + 1);
  }

  function assignRounds(events, rounds) {
    for (const event of events || []) {
      const index = roundIndexForTick(rounds, event?.tick);
      event.round = index >= 0 ? Number(rounds[index].number ?? index + 1) : null;
      event.roundIndex = index >= 0 ? index : -1;
    }
    return events;
  }

  /* ------------------------------------------------------------------ *
   * Event normalizasyonu — demoparser2 alan adları burada kapanır
   * ------------------------------------------------------------------ */

  function normalizeActor(event, role, fallbackRoles = []) {
    const prefixes = [role, ...fallbackRoles.map((fallback) => `${role}_${fallback}`)];
    const steamKeys = [];
    const nameKeys = [];
    for (const prefix of prefixes) {
      steamKeys.push(`${prefix}_steamid`, `${prefix}_player_steamid`, `${prefix}_xuid`);
      nameKeys.push(`${prefix}_name`, `${prefix}_player_name`);
    }
    steamKeys.push(`${role}_steamid`);
    nameKeys.push(`${role}`);
    const steamId = normalizeSteamId(firstText(event, steamKeys));
    const name = firstText(event, nameKeys);
    return { steamId, name, position: prefixedPosition(event, role) };
  }

  function normalizeKillEvent(raw) {
    const attacker = normalizeActor(raw, 'attacker');
    const victim = normalizeActor(raw, 'user', ['player']);
    if (!victim.steamId) victim.steamId = normalizeSteamId(firstText(raw, ['victim_steamid', 'player_steamid', 'steamid']));
    if (!victim.name) victim.name = firstText(raw, ['victim_name', 'player_name', 'name']);
    const assisterSteamId = normalizeSteamId(firstText(raw, ['assister_steamid', 'assister_player_steamid', 'assister_xuid']));
    const assisterName = firstText(raw, ['assister_name', 'assister_player_name']);
    const weapon = normalizeWeapon(firstText(raw, ['weapon', 'weapon_name', 'weapon_itemid']));
    const headshot = bool(firstValue(raw, ['headshot', 'is_headshot']));
    const assisterFlash = bool(firstValue(raw, ['assistedflash', 'assister_flash', 'flash_assist']));
    const nonPlayerWeapon = isNonPlayerWeapon(weapon.key);
    const attackerIsVictim = Boolean(attacker.steamId) && attacker.steamId === victim.steamId;
    return {
      type: 'kill',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: attacker.steamId,
      actorName: attacker.name,
      targetSteamId: victim.steamId,
      targetName: victim.name,
      assisterSteamId,
      assisterName,
      assistedFlash: assisterFlash,
      weapon: weapon.key,
      weaponLabel: weapon.label,
      damage: null,
      hitgroup: null,
      headshot,
      penetrated: bool(firstValue(raw, ['penetrated'])),
      noScope: bool(firstValue(raw, ['noscope', 'no_scope'])),
      thruSmoke: bool(firstValue(raw, ['thrusmoke', 'thru_smoke'])),
      attackerBlind: bool(firstValue(raw, ['attackerblind', 'attacker_blind'])),
      attackerInAir: bool(firstValue(raw, ['attackerinair', 'attacker_in_air'])),
      position: victim.position || attacker.position || eventPosition(raw),
      attackerPosition: attacker.position,
      suicide: !attacker.steamId || attackerIsVictim || nonPlayerWeapon,
      teamKill: false,
      isTrade: false,
      isEntry: false,
      raw
    };
  }

  function normalizeHurtEvent(raw) {
    const attacker = normalizeActor(raw, 'attacker');
    const victim = normalizeActor(raw, 'user', ['player']);
    if (!victim.steamId) victim.steamId = normalizeSteamId(firstText(raw, ['victim_steamid', 'player_steamid', 'steamid']));
    if (!victim.name) victim.name = firstText(raw, ['victim_name', 'player_name', 'name']);
    const weapon = normalizeWeapon(firstText(raw, ['weapon', 'weapon_name']));
    const healthDamage = num(firstValue(raw, ['dmg_health', 'dmghealth', 'damage_health'])) ?? 0;
    const armorDamage = num(firstValue(raw, ['dmg_armor', 'dmgorig'])) ?? 0;
    return {
      type: 'hurt',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: attacker.steamId,
      actorName: attacker.name,
      targetSteamId: victim.steamId,
      targetName: victim.name,
      weapon: weapon.key,
      weaponLabel: weapon.label,
      damage: healthDamage,
      armorDamage,
      hitgroup: num(firstValue(raw, ['hitgroup'])),
      headshot: num(firstValue(raw, ['hitgroup'])) === 1,
      position: victim.position || eventPosition(raw),
      attackerPosition: attacker.position,
      raw
    };
  }

  function normalizeShotEvent(raw) {
    const actor = normalizeActor(raw, 'user', ['player']);
    if (!actor.steamId) actor.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!actor.name) actor.name = firstText(raw, ['name', 'player_name']);
    const weapon = normalizeWeapon(firstText(raw, ['weapon', 'weapon_name', 'weapon_itemid']));
    return {
      type: 'shot',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: actor.steamId,
      actorName: actor.name,
      targetSteamId: '',
      targetName: '',
      weapon: weapon.key,
      weaponLabel: weapon.label,
      silenced: bool(firstValue(raw, ['silenced'])),
      position: actor.position || eventPosition(raw),
      raw
    };
  }

  const UTILITY_KIND_BY_EVENT = {
    smokegrenade_detonate: 'smoke',
    smokegrenade_expired: 'smoke',
    flashbang_detonate: 'flash',
    hegrenade_detonate: 'he',
    inferno_startburn: 'molotov',
    inferno_expire: 'molotov',
    decoy_started: 'decoy',
    decoy_detonate: 'decoy'
  };

  const UTILITY_PHASE_BY_EVENT = {
    smokegrenade_detonate: 'detonate',
    smokegrenade_expired: 'expire',
    flashbang_detonate: 'detonate',
    hegrenade_detonate: 'detonate',
    inferno_startburn: 'start',
    inferno_expire: 'expire',
    decoy_started: 'start',
    decoy_detonate: 'detonate'
  };

  function normalizeUtilityEvent(raw, eventName) {
    const actor = normalizeActor(raw, 'user', ['player']);
    if (!actor.steamId) actor.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!actor.name) actor.name = firstText(raw, ['name', 'player_name']);
    return {
      type: 'utility',
      eventName,
      kind: UTILITY_KIND_BY_EVENT[eventName] || 'unknown',
      phase: UTILITY_PHASE_BY_EVENT[eventName] || 'detonate',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: actor.steamId,
      actorName: actor.name,
      position: actor.position || eventPosition(raw),
      duration: num(firstValue(raw, ['blind_duration', 'duration'])),
      raw
    };
  }

  function normalizeBlindEvent(raw) {
    const victim = normalizeActor(raw, 'user', ['player']);
    if (!victim.steamId) victim.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!victim.name) victim.name = firstText(raw, ['name', 'player_name']);
    const attacker = normalizeActor(raw, 'attacker');
    return {
      type: 'blind',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: attacker.steamId,
      actorName: attacker.name,
      targetSteamId: victim.steamId,
      targetName: victim.name,
      duration: num(firstValue(raw, ['blind_duration'])),
      position: victim.position || eventPosition(raw),
      raw
    };
  }

  const BOMB_KIND_BY_EVENT = {
    bomb_planted: 'plant',
    bomb_defused: 'defuse',
    bomb_exploded: 'explode',
    bomb_dropped: 'drop',
    bomb_pickup: 'pickup'
  };

  function normalizeBombEvent(raw, eventName) {
    const actor = normalizeActor(raw, 'user', ['player']);
    if (!actor.steamId) actor.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!actor.name) actor.name = firstText(raw, ['name', 'player_name']);
    return {
      type: 'bomb',
      eventName,
      kind: BOMB_KIND_BY_EVENT[eventName] || 'unknown',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: actor.steamId,
      actorName: actor.name,
      position: actor.position || eventPosition(raw),
      raw
    };
  }

  /* Bağlam gerektirmeyen tek aktörlü eventler (disconnect, spawn, team change...). */
  function normalizeActorEvent(raw, type) {
    const actor = normalizeActor(raw, 'user', ['player']);
    if (!actor.steamId) actor.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!actor.name) actor.name = firstText(raw, ['name', 'player_name']);
    return {
      type,
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: actor.steamId,
      actorName: actor.name,
      position: actor.position || eventPosition(raw),
      raw
    };
  }

  function normalizePurchaseEvent(raw) {
    const actor = normalizeActor(raw, 'user', ['player']);
    if (!actor.steamId) actor.steamId = normalizeSteamId(firstText(raw, ['steamid', 'player_steamid']));
    if (!actor.name) actor.name = firstText(raw, ['name', 'player_name']);
    const weapon = normalizeWeapon(firstText(raw, ['weapon', 'item_name', 'itemid']));
    return {
      type: 'purchase',
      tick: num(raw?.tick) ?? 0,
      round: null,
      roundIndex: -1,
      actorSteamId: actor.steamId,
      actorName: actor.name,
      weapon: weapon.key,
      weaponLabel: weapon.label,
      cost: num(firstValue(raw, ['cost', 'price'])) ?? 0,
      team: num(firstValue(raw, ['team', 'team_num'])) ?? 0,
      raw
    };
  }

  const ROUND_END_REASONS = {
    1: 'Bomba patladı',
    2: 'Bomba imha edildi',
    3: 'CT elendi',
    4: 'T elendi',
    5: 'Süre doldu',
    6: 'Teslim',
    7: 'CT elendi',
    8: 'T elendi',
    9: 'Bomba patladı',
    10: 'Bomba imha edildi',
    11: 'Süre doldu',
    12: 'Teslim',
    0: 'Bilinmiyor'
  };

  function roundEndReasonLabel(value) {
    const key = num(value);
    if (key === null) return '';
    return ROUND_END_REASONS[key] || `Sebep ${key}`;
  }

  function sideFromTeamNumber(value) {
    return SIDE_BY_TEAM_NUMBER[Number(value)] || '';
  }

  function teamNumberFromSide(value) {
    const key = str(value).toUpperCase();
    return TEAM_NUMBER_BY_SIDE[key] || 0;
  }

  return {
    SIDE_BY_TEAM_NUMBER,
    TEAM_NUMBER_BY_SIDE,
    WEAPON_LABELS,
    num,
    str,
    bool,
    clamp,
    safeDiv,
    percent,
    normalizeSteamId,
    firstValue,
    firstText,
    firstNumber,
    makeDataset,
    missingDataset,
    emptyDataset,
    isAvailable,
    normalizeWeapon,
    isNonPlayerWeapon,
    positionFrom,
    prefixedPosition,
    eventPosition,
    distance3,
    distance2,
    sortByTick,
    roundIndexForTick,
    roundNumberForTick,
    assignRounds,
    normalizeActor,
    normalizeKillEvent,
    normalizeHurtEvent,
    normalizeShotEvent,
    normalizeUtilityEvent,
    normalizeBlindEvent,
    normalizeBombEvent,
    normalizePurchaseEvent,
    normalizeActorEvent,
    utilityDamageKind,
    isUtilityWeapon,
    isUtilityThrowEvent,
    isUtilityEndEvent,
    roundEndReasonLabel,
    sideFromTeamNumber,
    teamNumberFromSide
  };
});
