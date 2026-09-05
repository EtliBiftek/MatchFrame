import test from 'node:test';
import assert from 'node:assert/strict';
import common from '../ui/analysis/common.js';

const {
  num, str, bool, percent, safeDiv, normalizeSteamId, normalizeWeapon, isNonPlayerWeapon,
  roundIndexForTick, assignRounds, normalizeKillEvent, normalizeHurtEvent, normalizeUtilityEvent,
  makeDataset, missingDataset, isAvailable, distance3, sideFromTeamNumber, roundEndReasonLabel
} = common;

test('num/str/bool temel dönüşümler', () => {
  assert.equal(num('12.5'), 12.5);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
  assert.equal(num('abc'), null);
  assert.equal(str(undefined), '');
  assert.equal(str('  x  '), 'x');
  assert.equal(bool('true'), true);
  assert.equal(bool(1), true);
  assert.equal(bool('false'), false);
  assert.equal(bool(undefined), false);
});

test('safeDiv ve percent sıfıra bölünmede güvenli', () => {
  assert.equal(safeDiv(4, 2), 2);
  assert.equal(safeDiv(4, 0, -1), -1);
  assert.equal(percent(1, 4), 25);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(2, 3, 1), 66.7);
});

test('steamid normalizasyonu 0 ve boş değerleri temizler', () => {
  assert.equal(normalizeSteamId('76561198000000001'), '76561198000000001');
  // SteamID'ler 2^53 sınırını aştığı için sayısal değerler BigInt'ten geçirilir.
  assert.equal(normalizeSteamId(76561198000000001n), '76561198000000001');
  assert.equal(normalizeSteamId(90000001), '90000001');
  assert.equal(normalizeSteamId('0'), '');
  assert.equal(normalizeSteamId(undefined), '');
});

test('silah normalizasyonu weapon_ önekini ve takma adları temizler', () => {
  assert.deepEqual(normalizeWeapon('weapon_ak47'), { key: 'ak47', label: 'AK-47', raw: 'weapon_ak47' });
  assert.equal(normalizeWeapon('weapon_m4a1_silencer_off').key, 'm4a1_silencer');
  assert.equal(normalizeWeapon('weapon_molotov_projectile').key, 'molotov');
  assert.equal(normalizeWeapon('knife_t').key, 'knife');
  assert.equal(normalizeWeapon('weapon_knife_t').label, 'Bıçak');
  assert.equal(normalizeWeapon('').key, 'unknown');
  assert.equal(normalizeWeapon('weapon_usp_silencer').label, 'USP-S');
});

test('oyuncu dışı silahlar ayrıştırılır', () => {
  assert.equal(isNonPlayerWeapon('world'), true);
  assert.equal(isNonPlayerWeapon('planted_c4'), true);
  assert.equal(isNonPlayerWeapon('ak47'), false);
});

test('round eşleştirme sınırlarda doğru', () => {
  const rounds = [
    { number: 1, startTick: 1000, endTick: 2000 },
    { number: 2, startTick: 2001, endTick: 3000 }
  ];
  assert.equal(roundIndexForTick(rounds, 0), -1);
  assert.equal(roundIndexForTick(rounds, 999), -1);
  assert.equal(roundIndexForTick(rounds, 1000), 0);
  assert.equal(roundIndexForTick(rounds, 2000), 0);
  assert.equal(roundIndexForTick(rounds, 2001), 1);
  assert.equal(roundIndexForTick(rounds, 99999), 1);
  assert.equal(roundIndexForTick([], 100), -1);
});

test('assignRounds tickleri round numarasına bağlar', () => {
  const rounds = [
    { number: 1, startTick: 0, endTick: 100 },
    { number: 2, startTick: 100, endTick: 200 }
  ];
  const events = [{ tick: 5 }, { tick: 150 }, { tick: -5 }];
  assignRounds(events, rounds);
  assert.equal(events[0].round, 1);
  assert.equal(events[1].round, 2);
  assert.equal(events[2].round, null);
  assert.equal(events[2].roundIndex, -1);
});

test('kill eventi normalize edilir ve intihar işaretlenir', () => {
  const kill = normalizeKillEvent({
    tick: 1234,
    attacker_steamid: '76561198000000001',
    attacker_name: 'alpha',
    user_steamid: '76561198000000006',
    user_name: 'foxtrot',
    weapon: 'weapon_ak47',
    headshot: true,
    user_X: 100,
    user_Y: -20
  });
  assert.equal(kill.type, 'kill');
  assert.equal(kill.tick, 1234);
  assert.equal(kill.actorSteamId, '76561198000000001');
  assert.equal(kill.targetSteamId, '76561198000000006');
  assert.equal(kill.weapon, 'ak47');
  assert.equal(kill.weaponLabel, 'AK-47');
  assert.equal(kill.headshot, true);
  assert.equal(kill.suicide, false);
  assert.deepEqual(kill.position, { x: 100, y: -20, z: 0 });

  const fall = normalizeKillEvent({ tick: 10, user_steamid: '76561198000000006', weapon: 'world' });
  assert.equal(fall.suicide, true);
  assert.equal(fall.actorSteamId, '');

  const self = normalizeKillEvent({ tick: 10, attacker_steamid: '7', user_steamid: '7', weapon: 'hegrenade' });
  assert.equal(self.suicide, true);
});

test('assister ve flash assist alanları okunur', () => {
  const kill = normalizeKillEvent({
    tick: 500,
    attacker_steamid: '1',
    user_steamid: '2',
    assister_name: 'bravo',
    assister_steamid: '3',
    assistedflash: true
  });
  assert.equal(kill.assisterSteamId, '3');
  assert.equal(kill.assisterName, 'bravo');
  assert.equal(kill.assistedFlash, true);
});

test('hasar eventi normalize edilir', () => {
  const hurt = normalizeHurtEvent({
    tick: 900,
    attacker_steamid: '1',
    attacker_name: 'alpha',
    user_steamid: '2',
    user_name: 'bravo',
    dmg_health: 27,
    dmg_armor: 6,
    hitgroup: 1,
    weapon: 'weapon_ak47'
  });
  assert.equal(hurt.damage, 27);
  assert.equal(hurt.armorDamage, 6);
  assert.equal(hurt.headshot, true);
  assert.equal(hurt.weapon, 'ak47');
});

test('utility eventi tür ve faza göre normalize edilir', () => {
  const smoke = normalizeUtilityEvent({ tick: 10, user_steamid: '1', user_name: 'alpha', user_X: 5, user_Y: 6 }, 'smokegrenade_detonate');
  assert.equal(smoke.kind, 'smoke');
  assert.equal(smoke.phase, 'detonate');
  assert.deepEqual(smoke.position, { x: 5, y: 6, z: 0 });

  const expire = normalizeUtilityEvent({ tick: 20, user_steamid: '1' }, 'smokegrenade_expired');
  assert.equal(expire.kind, 'smoke');
  assert.equal(expire.phase, 'expire');

  const molotov = normalizeUtilityEvent({ tick: 30, user_steamid: '1' }, 'inferno_startburn');
  assert.equal(molotov.kind, 'molotov');
  assert.equal(molotov.phase, 'start');
});

test('dataset durumu: hata varsa available false', () => {
  const ok = makeDataset([{ tick: 1 }], null);
  assert.equal(ok.available, true);
  assert.equal(ok.count, 1);
  assert.equal(isAvailable(ok), true);

  const failed = makeDataset([{ tick: 1 }], 'player_hurt parse edilemedi');
  assert.equal(failed.available, false);
  assert.equal(failed.count, 0);
  assert.match(failed.error, /player_hurt/);

  const missing = missingDataset('veri yok');
  assert.equal(isAvailable(missing), false);
});

test('3B mesafe hesabı', () => {
  const distance = distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
  assert.equal(distance, 5);
  assert.equal(distance3(null, { x: 1, y: 1, z: 1 }), null);
});

test('takım numarası ve round_end sebep etiketleri', () => {
  assert.equal(sideFromTeamNumber(2), 'T');
  assert.equal(sideFromTeamNumber(3), 'CT');
  assert.equal(sideFromTeamNumber(0), '');
  assert.equal(roundEndReasonLabel(9), 'Bomba patladı');
  assert.equal(roundEndReasonLabel(2), 'Bomba imha edildi');
  assert.equal(roundEndReasonLabel(null), '');
});
