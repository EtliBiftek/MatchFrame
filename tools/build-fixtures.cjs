'use strict';

/*
 * Test fixture'larını üretir: node tools/build-fixtures.cjs
 *
 * Çıktılar test/fixtures/*.json altına yazılır ve repoya commit edilir.
 * Gerçek .dem dosyaları repoya girmez.
 */

const fs = require('node:fs');
const path = require('node:path');
const { makeDemo } = require('../test/helpers/demo-builder.cjs');

const OUT_DIR = path.join(__dirname, '..', 'test', 'fixtures');

function write(name, demo) {
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(demo, null, 2)}\n`, 'utf8');
  const size = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`fixture yazıldı: ${name}.json (${size} KB)`);
}

function halftimePlayers() {
  const base = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  return base.map((name, index) => {
    const firstHalfSide = index < 5 ? 'T' : 'CT';
    const sidesByRound = {};
    for (let round = 1; round <= 8; round++) {
      sidesByRound[round] = round <= 4 ? firstHalfSide : firstHalfSide === 'T' ? 'CT' : 'T';
    }
    return {
      name,
      steamid: String(76561198000000001n + BigInt(index)),
      side: firstHalfSide,
      sidesByRound,
      team_name: index < 5 ? 'Team Anka' : 'Team Yildiz'
    };
  });
}

/* ------------------------------------------------------------------ *
 * 1) basic-match — 8 round, devre arası taraf değişimi, tam event seti
 * ------------------------------------------------------------------ */
function buildBasicMatch() {
  const builder = makeDemo({
    map: 'de_mirage',
    server: 'FACEIT Test Server',
    file: 'C:/demos/basic-match.dem',
    tickRate: 64,
    players: halftimePlayers()
  });
  const p = builder.players;
  const [a1, a2, a3, a4, a5, b1, b2, b3, b4, b5] = p;

  // Round 1 — T bomba patlatarak kazanır, son CT 1v3 clutch'ı kaybeder.
  builder.addRound({ startTick: 1000, endTick: 3000, winner: 'T', reason: 9 });
  builder.addKill({ tick: 1200, attacker: a1, victim: b1, weapon: 'ak47', headshot: true });
  builder.addKill({ tick: 1280, attacker: b2, victim: a1, weapon: 'm4a1' }); // trade
  builder.addKill({ tick: 1400, attacker: a2, victim: b2, weapon: 'ak47' });
  builder.addKill({ tick: 1500, attacker: a2, victim: b3, weapon: 'ak47', assister: a3 });
  builder.addKill({ tick: 1600, attacker: a3, victim: b4, weapon: 'galilar' });
  builder.addPlant({ tick: 1800, player: a2 });
  builder.addKill({ tick: 1900, attacker: b5, victim: a3, weapon: 'awp' });
  builder.addExplosion({ tick: 2600 });
  builder.addUtility({ kind: 'smoke', tick: 1150, player: a4, x: -300, y: 420 });
  builder.addUtility({ kind: 'flash', tick: 1190, player: a5, x: -260, y: 380 });
  builder.addBlind({ tick: 1195, attacker: a5, victim: b1, duration: 2.4 });

  // Round 2 — CT imha ile kazanır.
  builder.addRound({ startTick: 3200, endTick: 5200, winner: 'CT', reason: 2 });
  builder.addKill({ tick: 3300, attacker: b1, victim: a1, weapon: 'm4a1', headshot: true });
  builder.addKill({ tick: 3350, attacker: a2, victim: b1, weapon: 'ak47' }); // trade
  builder.addKill({ tick: 3500, attacker: b2, victim: a2, weapon: 'awp' });
  builder.addKill({ tick: 3600, attacker: b3, victim: a3, weapon: 'm4a1' });
  builder.addKill({ tick: 3700, attacker: b4, victim: a4, weapon: 'famas' });
  builder.addPlant({ tick: 3800, player: a5 });
  builder.addKill({ tick: 4000, attacker: b5, victim: a5, weapon: 'm4a1' });
  builder.addDefuse({ tick: 4500, player: b2 });
  builder.addUtility({ kind: 'molotov', tick: 3600, player: b3, x: 120, y: -80 });
  builder.addUtility({ kind: 'he', tick: 3620, player: b4, x: 140, y: -60 });

  // Round 3 — son T oyuncusu 1v3 clutch kazanır.
  builder.addRound({ startTick: 5400, endTick: 7400, winner: 'T', reason: 7 });
  builder.addKill({ tick: 5500, attacker: a1, victim: b1, weapon: 'ak47' });
  builder.addKill({ tick: 5560, attacker: b2, victim: a1, weapon: 'm4a1' }); // trade
  builder.addKill({ tick: 5700, attacker: b3, victim: a2, weapon: 'aug' });
  builder.addKill({ tick: 5800, attacker: b4, victim: a3, weapon: 'm4a1' });
  builder.addKill({ tick: 5850, attacker: a5, victim: b2, weapon: 'ak47' });
  builder.addKill({ tick: 5900, attacker: b5, victim: a4, weapon: 'awp' });
  builder.addKill({ tick: 6200, attacker: a5, victim: b3, weapon: 'ak47', headshot: true });
  builder.addKill({ tick: 6400, attacker: a5, victim: b4, weapon: 'ak47' });
  builder.addKill({ tick: 6600, attacker: a5, victim: b5, weapon: 'ak47' });

  // Round 4 — T elenme ile kazanır; bir intihar ve bir takım arkadaşı öldürme var.
  builder.addRound({ startTick: 7600, endTick: 9600, winner: 'T', reason: 7 });
  builder.addKill({ tick: 7700, attacker: a1, victim: b1, weapon: 'ak47', headshot: true });
  builder.addKill({ tick: 7800, attacker: a2, victim: b2, weapon: 'ak47' });
  builder.addKill({ tick: 7900, attacker: a2, victim: b3, weapon: 'ak47' });
  builder.addKill({ tick: 8000, victim: b5, weapon: 'world' }); // düşerek ölüm
  builder.addKill({ tick: 8100, attacker: b4, victim: a3, weapon: 'm4a1' });
  builder.addKill({ tick: 8200, attacker: a4, victim: a5, weapon: 'ak47' }); // team kill
  builder.addKill({ tick: 8300, attacker: a4, victim: b4, weapon: 'ak47' });

  // Round 5 — devre arası sonrası ilk round: CT elenme ile kazanır.
  builder.addRound({ startTick: 9800, endTick: 11800, winner: 'CT', reason: 7 });
  builder.addKill({ tick: 9900, attacker: b1, victim: a1, weapon: 'ak47' });
  builder.addKill({ tick: 9960, attacker: a2, victim: b1, weapon: 'm4a1' }); // trade
  builder.addKill({ tick: 10100, attacker: a3, victim: b2, weapon: 'm4a1' });
  builder.addKill({ tick: 10200, attacker: b3, victim: a2, weapon: 'ak47' });
  builder.addKill({ tick: 10300, attacker: a4, victim: b3, weapon: 'm4a1' });
  builder.addKill({ tick: 10400, attacker: a5, victim: b4, weapon: 'awp' });
  builder.addKill({ tick: 10500, attacker: a3, victim: b5, weapon: 'm4a1' });

  // Round 6 — T bomba ile kazanır, CT 1v3 clutch kaybeder.
  builder.addRound({ startTick: 12000, endTick: 14000, winner: 'T', reason: 9 });
  builder.addKill({ tick: 12100, attacker: b1, victim: a1, weapon: 'ak47' });
  builder.addKill({ tick: 12200, attacker: a2, victim: b1, weapon: 'm4a1' }); // trade
  builder.addKill({ tick: 12300, attacker: b2, victim: a2, weapon: 'ak47' });
  builder.addKill({ tick: 12400, attacker: b2, victim: a3, weapon: 'ak47' });
  builder.addKill({ tick: 12500, attacker: b2, victim: a4, weapon: 'ak47' });
  builder.addKill({ tick: 12600, attacker: a5, victim: b2, weapon: 'm4a1' });
  builder.addPlant({ tick: 12800, player: b3 });
  builder.addExplosion({ tick: 13500 });
  builder.addUtility({ kind: 'smoke', tick: 12700, player: b4, x: 620, y: 180 });

  // Round 7 — CT elenme ile kazanır.
  builder.addRound({ startTick: 14200, endTick: 16200, winner: 'CT', reason: 7 });
  builder.addKill({ tick: 14300, attacker: a1, victim: b1, weapon: 'm4a1', headshot: true });
  builder.addKill({ tick: 14360, attacker: b2, victim: a1, weapon: 'ak47' }); // trade
  builder.addKill({ tick: 14500, attacker: a2, victim: b2, weapon: 'm4a1' });
  builder.addKill({ tick: 14600, attacker: b3, victim: a2, weapon: 'galilar' });
  builder.addKill({ tick: 14700, attacker: a3, victim: b3, weapon: 'm4a1' });
  builder.addKill({ tick: 14800, attacker: b4, victim: a3, weapon: 'ak47' });
  builder.addKill({ tick: 15000, attacker: a4, victim: b4, weapon: 'm4a1' });
  builder.addKill({ tick: 15100, attacker: b5, victim: a4, weapon: 'ak47' });
  builder.addKill({ tick: 15200, attacker: a5, victim: b5, weapon: 'm4a1' });

  // Round 8 — T kazanır, flash assist var.
  builder.addRound({ startTick: 16400, endTick: 18400, winner: 'T', reason: 7 });
  builder.addKill({ tick: 16500, attacker: b1, victim: a1, weapon: 'ak47', headshot: true });
  builder.addKill({ tick: 16560, attacker: a2, victim: b1, weapon: 'm4a1', assister: a3, assistedflash: true });
  builder.addKill({ tick: 16700, attacker: b2, victim: a2, weapon: 'ak47' });
  builder.addKill({ tick: 16800, attacker: b3, victim: a3, weapon: 'ak47' });
  builder.addKill({ tick: 16900, attacker: b4, victim: a4, weapon: 'ak47' });
  builder.addKill({ tick: 17000, attacker: a5, victim: b4, weapon: 'm4a1' });
  builder.addKill({ tick: 17100, attacker: b5, victim: a5, weapon: 'ak47' });
  builder.addUtility({ kind: 'flash', tick: 16520, player: a3, x: -140, y: 300 });
  builder.addBlind({ tick: 16530, attacker: a3, victim: b1, duration: 3.1 });

  // Hasar ve atış verisi (ADR / accuracy için)
  for (const kill of [...builder.demo.deaths]) {
    const attacker = kill.attacker_steamid;
    const victim = kill.user_steamid;
    if (!attacker || attacker === victim || kill.weapon === 'world') continue;
    const total = kill.headshot ? 128 : 104;
    const chunks = [Math.round(total * 0.26), Math.round(total * 0.26), total - Math.round(total * 0.26) * 2];
    chunks.forEach((value, index) => {
      builder.addDamage({
        tick: kill.tick - 60 + index * 20,
        attacker,
        victim,
        weapon: kill.weapon,
        damage: value,
        headshot: Boolean(kill.headshot) && index === 2
      });
    });
    for (let i = 0; i < 4; i++) {
      builder.addShot({ tick: kill.tick - 40 + i * 10, player: attacker, weapon: kill.weapon });
    }
  }

  builder.buildRoundStartFrames(2, 16);
  return builder.finalize();
}

/* ------------------------------------------------------------------ *
 * 2) clutch-1v3 — round_end winner alanı yok; sonuç infer edilmeli
 * ------------------------------------------------------------------ */
function buildClutch() {
  const builder = makeDemo({
    map: 'de_inferno',
    server: 'Clutch Test',
    file: 'C:/demos/clutch-1v3.dem',
    tickRate: 64
  });
  const p = builder.players;
  builder.addRound({ startTick: 1000, endTick: 4000 });
  // T tarafı tek oyuncuya düşüyor (1v3), sonra üçünü de alıyor.
  builder.addKill({ tick: 1200, attacker: p[4], victim: p[5], weapon: 'ak47' });
  builder.addKill({ tick: 1250, attacker: p[4], victim: p[6], weapon: 'ak47' });
  builder.addKill({ tick: 1300, attacker: p[7], victim: p[0], weapon: 'm4a1' });
  builder.addKill({ tick: 1400, attacker: p[7], victim: p[1], weapon: 'm4a1' });
  builder.addKill({ tick: 1500, attacker: p[8], victim: p[2], weapon: 'm4a1' });
  builder.addKill({ tick: 1600, attacker: p[9], victim: p[3], weapon: 'm4a1' });
  builder.addKill({ tick: 2000, attacker: p[4], victim: p[7], weapon: 'ak47' });
  builder.addKill({ tick: 2200, attacker: p[4], victim: p[8], weapon: 'ak47' });
  builder.addKill({ tick: 2400, attacker: p[4], victim: p[9], weapon: 'ak47' });
  builder.buildRoundStartFrames(1, 16);
  return builder.finalize();
}

/* ------------------------------------------------------------------ *
 * 3) trade-scenario — trade penceresi içi ve dışı
 * ------------------------------------------------------------------ */
function buildTradeScenario() {
  const builder = makeDemo({
    map: 'de_nuke',
    server: 'Trade Test',
    file: 'C:/demos/trade-scenario.dem',
    tickRate: 64
  });
  const p = builder.players;
  builder.addRound({ startTick: 500, endTick: 3000 });
  builder.addKill({ tick: 600, attacker: p[0], victim: p[5], weapon: 'ak47' }); // entry
  builder.addKill({ tick: 700, attacker: p[6], victim: p[0], weapon: 'm4a1' }); // trade (100 tick < 320)
  builder.addKill({ tick: 1200, attacker: p[1], victim: p[6], weapon: 'ak47' }); // entry sonrası
  builder.addKill({ tick: 2200, attacker: p[7], victim: p[1], weapon: 'm4a1' }); // 1000 tick > 320 → trade değil
  builder.buildRoundStartFrames(1, 16);
  return builder.finalize();
}

/* ------------------------------------------------------------------ *
 * 4) flash-assist — flash assist ve kör etme metrikleri
 * ------------------------------------------------------------------ */
function buildFlashAssist() {
  const builder = makeDemo({
    map: 'de_ancient',
    server: 'Flash Test',
    file: 'C:/demos/flash-assist.dem',
    tickRate: 64
  });
  const p = builder.players;
  builder.addRound({ startTick: 500, endTick: 3000 });
  builder.addUtility({ kind: 'flash', tick: 600, player: p[1], x: 120, y: 240 });
  builder.addBlind({ tick: 640, attacker: p[1], victim: p[6], duration: 2.6 });
  builder.addBlind({ tick: 660, attacker: p[1], victim: p[7], duration: 1.4 });
  builder.addBlind({ tick: 680, attacker: p[1], victim: p[2], duration: 3.2 }); // takım arkadaşı
  builder.addKill({ tick: 720, attacker: p[0], victim: p[6], weapon: 'ak47', assister: p[1], assistedflash: true });
  builder.addKill({ tick: 900, attacker: p[0], victim: p[7], weapon: 'ak47', assister: p[1], assistedflash: true });
  builder.buildRoundStartFrames(1, 16);
  return builder.finalize();
}

/* ------------------------------------------------------------------ *
 * 5) missing-events — hasar/atış eventleri parse edilemedi
 * ------------------------------------------------------------------ */
function buildMissingEvents() {
  const builder = makeDemo({
    map: 'de_overpass',
    server: 'Missing Events',
    file: 'C:/demos/missing-events.dem',
    tickRate: 64,
    omitDamage: true,
    omitShots: true,
    eventStatus: {
      player_hurt: { ok: false, error: 'player_hurt field dmg_health bulunamadı' },
      weapon_fire: { ok: false, error: 'weapon_fire parse hatası' }
    }
  });
  const p = builder.players;
  builder.addRound({ startTick: 1000, endTick: 3000, winner: 'T', reason: 9 });
  builder.addKill({ tick: 1200, attacker: p[0], victim: p[5], weapon: 'ak47', headshot: true });
  builder.addKill({ tick: 1400, attacker: p[0], victim: p[6], weapon: 'ak47' });
  builder.addPlant({ tick: 1600, player: p[1] });
  builder.addExplosion({ tick: 2400 });
  builder.buildRoundStartFrames(1, 16);
  return builder.finalize();
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  write('basic-match', buildBasicMatch());
  write('clutch-1v3', buildClutch());
  write('trade-scenario', buildTradeScenario());
  write('flash-assist', buildFlashAssist());
  write('missing-events', buildMissingEvents());
}

main();
