'use strict';

/*
 * demo-worker.cjs için entegrasyon testi.
 *
 * @laihoe/demoparser2 ve worker_threads taklit edilir; amaç worker'ın
 *   - yeni eventleri (player_hurt, weapon_fire, bullet_impact, round_freeze_end)
 *   - eventStatus raporlamasını
 *   - parse hatalarında graceful degradation davranışını
 * doğru üretmesini kontrol etmek.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const analysis = require('../ui/analysis/match-analysis.js');

const WORKER = path.join(__dirname, '..', 'electron', 'demo-worker.cjs');

function runWorker(options = {}) {
  const messages = [];
  let messageHandler = null;

  const parser = {
    parseHeader: () => ({ map_name: 'de_mirage', server_name: 'Test' }),
    parsePlayerInfo: () => [
      { steamid: '76561198000000001', name: 'alpha' },
      { steamid: '76561198000000002', name: 'bravo' }
    ],
    parseEvent: (file, name) => {
      if (options.fail && options.fail.includes(name)) {
        const error = new Error(`${name} alanları bulunamadı`);
        throw error;
      }
      const rows = {
        round_start: [{ tick: 1000, total_rounds_played: 0, is_warmup_period: false, round_start_time: 2 }],
        round_end: [{ tick: 2000, winner: 2, reason: 9, total_rounds_played: 0 }],
        round_freeze_end: [{ tick: 1100 }],
        player_death: [{
          tick: 1500,
          attacker_steamid: '76561198000000001',
          attacker_name: 'alpha',
          user_steamid: '76561198000000002',
          user_name: 'bravo',
          weapon: 'ak47',
          headshot: true,
          assistedflash: false
        }],
        player_hurt: [{
          tick: 1400,
          attacker_steamid: '76561198000000001',
          attacker_name: 'alpha',
          user_steamid: '76561198000000002',
          user_name: 'bravo',
          dmg_health: 27,
          dmg_armor: 4,
          hitgroup: 2,
          weapon: 'ak47'
        }],
        weapon_fire: [{ tick: 1450, user_steamid: '76561198000000001', user_name: 'alpha', weapon: 'ak47' }],
        bullet_impact: [{ tick: 1451, user_steamid: '76561198000000001', X: 10, Y: 20, Z: 30 }],
        bomb_planted: [{ tick: 1600, user_steamid: '76561198000000001', user_name: 'alpha', user_X: 1, user_Y: 2 }],
        bomb_defused: [],
        bomb_exploded: [{ tick: 1900 }],
        bomb_dropped: [],
        bomb_pickup: [],
        smokegrenade_detonate: [{ tick: 1200, user_steamid: '76561198000000001', user_name: 'alpha', user_X: 5, user_Y: 6 }],
        smokegrenade_expired: [],
        inferno_startburn: [],
        inferno_expire: [],
        hegrenade_detonate: [],
        flashbang_detonate: [],
        player_blind: [],
        decoy_started: [],
        decoy_detonate: [],
        item_purchase: [{
          tick: 1050,
          user_steamid: '76561198000000001',
          user_name: 'alpha',
          weapon: 'ak47',
          cost: 2700,
          team: 2
        }],
        player_spawn: [{ tick: 1010, user_steamid: '76561198000000001', user_name: 'alpha', team_num: 2 }],
        player_team: [{ tick: 1005, user_steamid: '76561198000000002', user_name: 'bravo', team: 3, oldteam: 2 }],
        player_disconnect: [{ tick: 1800, user_steamid: '76561198000000002', user_name: 'bravo' }],
        begin_new_match: [{ tick: 500, map: 'de_mirage' }]
      };
      return rows[name] || [];
    },
    parseTicks: (file, props, wantedTicks) => {
      if (options.failTicks) throw new Error('tick parse hatası');
      const rows = [];
      for (const tick of wantedTicks || []) {
        for (const [index, steamid] of ['76561198000000001', '76561198000000002'].entries()) {
          rows.push({
            steamid,
            name: index === 0 ? 'alpha' : 'bravo',
            X: 100 + index * 50,
            Y: 200,
            Z: 0,
            pitch: 0,
            yaw: 90,
            fov: 90,
            duck_amount: 0,
            in_crouch: false,
            health: 100,
            armor: 100,
            is_alive: true,
            team_num: index === 0 ? 2 : 3,
            team_name: '',
            team_clan_name: index === 0 ? 'Team A' : 'Team B',
            player_color: '',
            active_weapon_name: 'weapon_ak47',
            active_weapon_ammo: 30,
            total_ammo_left: 90,
            flash_duration: 0,
            inventory: []
          });
        }
      }
      return rows;
    }
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '@laihoe/demoparser2') return parser;
    if (request === 'node:worker_threads') {
      return {
        parentPort: {
          postMessage: (message) => messages.push(message),
          on: (event, handler) => {
            if (event === 'message') messageHandler = handler;
          }
        }
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[WORKER];
    require(WORKER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[WORKER];
  }

  assert.ok(messageHandler, 'worker message handler kaydetmedi');
  messageHandler({ file: options.file || 'C:/demos/test.dem' });
  return messages;
}

test('worker yeni eventleri ve eventStatus raporunu üretir', () => {
  const messages = runWorker();
  const done = messages.filter((message) => message.type !== 'progress');
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, true);

  const data = done[0].data;
  for (const key of ['deaths', 'damage', 'shots', 'impacts', 'freezeEnds', 'roundEnds', 'eventStatus', 'blinds',
    'purchases', 'spawns', 'teamChanges', 'disconnects', 'matchStarts']) {
    assert.ok(key in data, `çıktıda ${key} yok`);
  }
  assert.equal(data.purchases.length, 1);
  assert.equal(data.spawns.length, 1);
  assert.equal(data.teamChanges.length, 1);
  assert.equal(data.disconnects.length, 1);
  assert.equal(data.matchStarts.length, 1);
  assert.equal(data.eventStatus.item_purchase.ok, true);
  assert.equal(data.eventStatus.player_disconnect.ok, true);
  assert.equal(data.damage.length, 1);
  assert.equal(data.shots.length, 1);
  assert.equal(data.impacts.length, 1);
  assert.equal(data.eventStatus.player_hurt.ok, true);
  assert.equal(data.eventStatus.weapon_fire.ok, true);
  assert.equal(data.eventStatus.player_death.ok, true);
  assert.equal(data.eventStatus.round_end.ok, true);
  assert.equal(data.eventStatus.round_end.variant, 0, 'genişletilmiş round_end varyantı kullanılmalı');
});

test('round_freeze_end round meta içinde freezeEndTick olarak taşınır', () => {
  const data = runWorker().filter((message) => message.type !== 'progress')[0].data;
  assert.equal(data.roundMeta.length, 1);
  assert.equal(data.roundMeta[0].startTick, 1000);
  assert.equal(data.roundMeta[0].freezeEndTick, 1100, 'freeze bitişi round başlangıcından sonra gelmeli');
  assert.equal(data.roundMeta[0].endTick, 2000);

  const model = analysis.buildMatchModel({ ...data, file: 'test.dem' });
  assert.equal(model.rounds[0].freezeEndTick, 1100);
  assert.equal(model.rounds[0].jumpTick, 1100, 'replay hedefi freeze bitişi olmalı');
});

test('satın alma verisi modele ekonomi olarak yansır', () => {
  const data = runWorker().filter((message) => message.type !== 'progress')[0].data;
  const model = analysis.buildMatchModel({ ...data, file: 'test.dem' });
  assert.equal(model.availability.purchases.available, true);
  assert.equal(model.rounds[0].economy.spend, 2700);
  assert.equal(model.rounds[0].economy.buys, 1);
  assert.equal(model.players['76561198000000001'].totals.economy.spend, 2700);
  assert.equal(model.players['76561198000000002'].disconnected, true, 'disconnect bayrağı işaretlenmeli');
});

test('item_purchase parse edilemezse ekonomi unavailable kalır', () => {
  const data = runWorker({ fail: ['item_purchase'] }).filter((message) => message.type !== 'progress')[0].data;
  assert.equal(data.purchases.length, 0);
  assert.equal(data.eventStatus.item_purchase.ok, false);
  const model = analysis.buildMatchModel({ ...data, file: 'test.dem' });
  assert.equal(model.availability.purchases.available, false);
  assert.equal(model.rounds[0].economy.spend, 0);
});

test('worker ilerleme bildirimleri gönderir', () => {
  const progress = runWorker().filter((message) => message.type === 'progress');
  assert.ok(progress.length >= 6);
  assert.equal(progress[0].percent, 2);
  assert.equal(progress.at(-1).percent, 100);
  for (let i = 1; i < progress.length; i += 1) {
    assert.ok(progress[i].percent >= progress[i - 1].percent, 'ilerleme geri gitmemeli');
  }
});

test('parse edilemeyen eventler boş listeye düşer ve status kaydeder', () => {
  const data = runWorker({ fail: ['player_hurt', 'weapon_fire'] }).filter((message) => message.type !== 'progress')[0].data;
  assert.equal(data.damage.length, 0);
  assert.equal(data.shots.length, 0);
  assert.equal(data.eventStatus.player_hurt.ok, false);
  assert.match(data.eventStatus.player_hurt.error, /player_hurt/);
  assert.equal(data.eventStatus.weapon_fire.ok, false);
  assert.equal(data.deaths.length, 1, 'diğer eventler etkilenmemeli');
});

test('tick parse hatası demo sonucunu iptal etmez', () => {
  const data = runWorker({ failTicks: true }).filter((message) => message.type !== 'progress')[0].data;
  assert.ok(data.viewerError, 'viewerError kaydedilmeli');
  assert.equal(data.frames.length, 0);
  assert.equal(data.deaths.length, 1);
});

test('worker çıktısı analiz modeline doğrudan beslenebilir', () => {
  const data = runWorker().filter((message) => message.type !== 'progress')[0].data;
  const model = analysis.buildMatchModel({ ...data, file: 'test.dem' });
  assert.equal(model.ready, true);
  assert.equal(model.rounds.length, 1);
  assert.equal(model.rounds[0].outcomeSource, 'parser', 'round_end winner alanı kullanılmalı');
  assert.equal(model.rounds[0].winnerSide, 'T');
  assert.equal(model.rounds[0].reason, 'Bomba patladı');
  assert.equal(model.availability.damage.available, true);
  assert.equal(model.players['76561198000000001'].totals.kills, 1);
  assert.equal(model.players['76561198000000001'].totals.damage, 27);
});

test('worker çıktısında hasar parse edilemezse model ADR üretmez', () => {
  const data = runWorker({ fail: ['player_hurt'] }).filter((message) => message.type !== 'progress')[0].data;
  const model = analysis.buildMatchModel({ ...data, file: 'test.dem' });
  assert.equal(model.availability.damage.available, false);
  assert.match(model.availability.damage.error, /player_hurt/);
  assert.equal(model.players['76561198000000001'].totals.adr, null);
});
