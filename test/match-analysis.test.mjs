import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analysis from '../ui/analysis/match-analysis.js';
import { makeDemo } from './helpers/demo-builder.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const { buildMatchModel, playerRows, roundRows, simulateRound } = analysis;

function playerByName(model, name) {
  return Object.values(model.players).find((player) => player.name === name);
}

test('demo yoksa model boş döner', () => {
  const model = buildMatchModel(null);
  assert.equal(model.ready, false);
  assert.match(model.reason, /Demo/);
  assert.deepEqual(model.rounds, []);
  assert.deepEqual(model.teams, []);
});

test('boş demo nesnesi çökmez, availability raporlar', () => {
  const model = buildMatchModel({ header: {}, players: [], roundMeta: [] });
  assert.equal(model.ready, true);
  assert.equal(model.rounds.length, 0);
  assert.equal(model.availability.rounds.available, false);
  assert.equal(model.availability.kills.available, false);
  assert.match(model.availability.kills.error, /player_death/);
});

test('basic-match: maç meta verisi ve skor', () => {
  const model = buildMatchModel(fixture('basic-match'));
  assert.equal(model.ready, true);
  assert.equal(model.match.map, 'de_mirage');
  assert.equal(model.match.server, 'FACEIT Test Server');
  assert.equal(model.match.roundsPlayed, 8);
  assert.equal(model.match.tickRate, 64);

  // Round 1-4 T kazanır (5), CT 3 — takım skorları taraftan bağımsız tutulur.
  const [teamOne, teamTwo] = model.teams;
  assert.equal(teamOne.score, 5);
  assert.equal(teamTwo.score, 3);
  assert.equal(teamOne.players.length, 5);
  assert.equal(teamTwo.players.length, 5);
  assert.equal(model.match.score[teamOne.id], 5);
});

test('basic-match: devre arası taraf değişimi takım kimliğini bozmaz', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const alpha = playerByName(model, 'alpha');
  const juliet = playerByName(model, 'juliet');
  assert.notEqual(alpha.teamId, juliet.teamId);
  assert.equal(alpha.sidesPlayed.T, 4);
  assert.equal(alpha.sidesPlayed.CT, 4);

  const roundOne = model.rounds[0];
  const roundFive = model.rounds[4];
  assert.equal(roundOne.teamBySide.T, alpha.teamId);
  assert.equal(roundFive.teamBySide.CT, alpha.teamId);
});

test('basic-match: round sonuçları ve clutch kayıtları', () => {
  const model = buildMatchModel(fixture('basic-match'));
  assert.equal(model.rounds[0].winnerSide, 'T');
  assert.equal(model.rounds[0].reason, 'Bomba patladı');
  assert.equal(model.rounds[1].winnerSide, 'CT');
  assert.equal(model.rounds[1].reason, 'Bomba imha edildi');
  assert.equal(model.rounds[0].outcomeSource, 'parser');

  // Round 1: son CT 1v4 clutch'ı kaybeder
  const firstClutch = model.rounds[0].clutch;
  assert.equal(firstClutch.side, 'CT');
  assert.equal(firstClutch.opponents, 4);
  assert.equal(firstClutch.won, false);

  // Round 3: son T 1v3 clutch kazanır
  const wonClutch = model.rounds[2].clutch;
  assert.equal(wonClutch.side, 'T');
  assert.equal(wonClutch.opponents, 3);
  assert.equal(wonClutch.won, true);

  const echo = playerByName(model, 'echo');
  assert.equal(echo.totals.clutches.won, 1);
  assert.equal(echo.totals.clutches.byCount['3'].won, 1);
});

test('clutch-1v3: round_end winner yokken sonuç infer edilir', () => {
  const model = buildMatchModel(fixture('clutch-1v3'));
  const round = model.rounds[0];
  assert.equal(round.outcomeSource, 'inferred');
  assert.equal(round.winnerSide, 'T');
  assert.equal(round.reason, 'CT elendi');
  assert.equal(round.clutch.opponents, 3);
  assert.equal(round.clutch.won, true);
  assert.equal(model.teams[0].score, 1);
});

test('entry kill ve trade kill doğru işaretlenir', () => {
  const model = buildMatchModel(fixture('trade-scenario'));
  const round = model.rounds[0];
  const kills = round.kills;

  const entry = kills.find((kill) => kill.isEntry);
  assert.ok(entry, 'entry kill bulunamadı');
  assert.equal(entry.actorName, 'alpha');

  // golf, foxtrot'un ölümünün intikamını alır → trade kill
  const traded = kills.find((kill) => kill.isTrade);
  assert.ok(traded, 'trade kill bulunamadı');
  assert.equal(traded.actorName, 'golf');
  assert.equal(traded.targetName, 'alpha');
  assert.equal(traded.tradeFor, playerByName(model, 'foxtrot').steamId);

  // 500 tick sonra gelen kill trade penceresi (5 sn = 320 tick) dışındadır
  const late = kills.find((kill) => Number(kill.tick) === 1200);
  assert.equal(late.isTrade, false);

  const foxtrot = playerByName(model, 'foxtrot');
  const golf = playerByName(model, 'golf');
  assert.equal(foxtrot.totals.tradedDeaths, 1);
  assert.equal(golf.totals.tradeKills, 1);

  const alpha = playerByName(model, 'alpha');
  assert.equal(alpha.totals.entryKills, 1);
  assert.equal(alpha.totals.tradeKills, 0);
});

test('trade penceresi yapılandırılabilir', () => {
  const demo = fixture('trade-scenario');
  const wide = buildMatchModel(demo, { tradeWindowSeconds: 20 });
  const late = wide.rounds[0].kills.find((kill) => Number(kill.tick) === 1200);
  assert.equal(late.isTrade, true);
});

test('intihar ve takım arkadaşı öldürme kill sayılmaz', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const round = model.rounds[3]; // round 4
  const suicide = round.kills.find((kill) => kill.weapon === 'world');
  assert.equal(suicide.suicide, true);
  assert.equal(suicide.actorSteamId, '');

  const teamKill = round.kills.find((kill) => kill.actorName === 'delta' && kill.targetName === 'echo');
  assert.equal(teamKill.teamKill, true);

  const delta = playerByName(model, 'delta');
  // delta'nın round 4'te bir team kill'i ve bir normal kill'i var: yalnızca normali sayılır
  assert.equal(delta.totals.teamKills, 1);
  assert.equal(delta.totals.kills, 3);
});

test('ADR, KAST ve hasar verisi yoksa null döner', () => {
  const withDamage = buildMatchModel(fixture('basic-match'));
  const echo = playerByName(withDamage, 'echo');
  assert.equal(withDamage.availability.damage.available, true);
  assert.ok(echo.totals.adr > 0);
  assert.ok(echo.totals.kastPercent >= 0);

  const missing = buildMatchModel(fixture('missing-events'));
  assert.equal(missing.availability.damage.available, false);
  assert.match(missing.availability.damage.error, /player_hurt/);
  assert.equal(missing.availability.shots.available, false);
  assert.equal(missing.availability.kills.available, true);
  const alpha = playerByName(missing, 'alpha');
  assert.equal(alpha.totals.adr, null);
  assert.ok(missing.notes.some((note) => note.dataset === 'damage'));
});

test('missing-events: eksik veriye rağmen round ve kill analizi çalışır', () => {
  const model = buildMatchModel(fixture('missing-events'));
  assert.equal(model.ready, true);
  assert.equal(model.rounds.length, 1);
  assert.equal(model.rounds[0].winnerSide, 'T');
  assert.equal(model.rounds[0].bombExploded, true);
  const alpha = playerByName(model, 'alpha');
  assert.equal(alpha.totals.kills, 2);
  assert.equal(alpha.totals.headshotKills, 1);
  assert.equal(alpha.totals.headshotPercent, 50);
});

test('flash-assist: flash assist ve kör etme sayıları', () => {
  const model = buildMatchModel(fixture('flash-assist'));
  const bravo = playerByName(model, 'bravo');
  assert.equal(bravo.totals.assists, 2);
  assert.equal(bravo.totals.flashAssists, 2);
  assert.equal(bravo.totals.utility.flash, 1);
  const alpha = playerByName(model, 'alpha');
  assert.equal(alpha.totals.kills, 2);
  assert.equal(model.events.blinds.length, 3);
});

test('utility eventleri round ve oyuncuya bağlanır', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const delta = playerByName(model, 'delta');
  assert.equal(delta.totals.utility.smoke, 1);
  const india = playerByName(model, 'india');
  assert.equal(india.totals.utility.he, 1);
  assert.equal(india.totals.utility.smoke, 1);
  const hotel = playerByName(model, 'hotel');
  assert.equal(hotel.totals.utility.molotov, 1);
});

test('silah dağılımı ve atış sayıları toplanır', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const bravo = playerByName(model, 'bravo');
  const totalWeaponKills = Object.values(bravo.weapons).reduce((sum, weapon) => sum + weapon.kills, 0);
  assert.equal(totalWeaponKills, bravo.totals.kills);
  assert.equal(bravo.weapons.ak47.kills, 5);
  assert.equal(bravo.weapons.m4a1.kills, 4);
  assert.equal(bravo.weapons.ak47.shots, 20);
  assert.ok(bravo.weapons.ak47.damage > 0);
  assert.equal(bravo.weapons.ak47.headshots, 0);

  const echo = playerByName(model, 'echo');
  assert.equal(echo.weapons.ak47.headshots, 1);
  assert.equal(echo.weapons.awp.kills, 1);
});

test('round filtresi oyuncu satırlarını daraltır', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const all = playerRows(model);
  assert.equal(all.length, 10);
  const roundThree = playerRows(model, { round: 3 });
  const echo = roundThree.find((row) => row.name === 'echo');
  assert.equal(echo.kills, 4); // 1v3 clutch + entry trade
  const alpha = roundThree.find((row) => row.name === 'alpha');
  assert.equal(alpha.kills, 1);
  assert.equal(alpha.deaths, 1);
});

test('round satırları replay için tick bilgisi taşır', () => {
  const model = buildMatchModel(fixture('basic-match'));
  const rows = roundRows(model);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].startTick, 1000);
  assert.equal(rows[0].endTick, 3000);
  assert.equal(rows[0].winnerSide, 'T');
  assert.equal(rows[0].firstKill.attackerName, 'alpha');
  assert.equal(rows[0].scoreAfter[model.teams[0].id], 1);
});

test('model bir kez kurulur ve tekrar çağrıda aynı sonucu verir', () => {
  const demo = fixture('basic-match');
  const first = buildMatchModel(demo);
  const second = buildMatchModel(demo);
  assert.deepEqual(first.match, second.match);
  assert.deepEqual(first.rounds.map((round) => round.winnerSide), second.rounds.map((round) => round.winnerSide));
});

test('simulateRound hayatta kalan sayılarını doğru hesaplar', () => {
  const demo = fixture('clutch-1v3');
  const builderSides = new Map();
  for (const player of demo.players) builderSides.set(String(player.steamid), player.team_number);
  const model = buildMatchModel(demo);
  const kills = model.rounds[0].kills;
  const result = simulateRound(model.rounds[0], builderSides, kills);
  assert.equal(result.counts[2], 1);
  assert.equal(result.counts[3], 0);
  assert.equal(result.clutch.opponents, 3);
});

test('bozuk/eksik alanlı demo hesaplamayı çökertmez', () => {
  const builder = makeDemo({});
  builder.addRound({ startTick: 0, endTick: 1000 });
  builder.addKill({ tick: 10, attacker: null, victim: builder.players[0], weapon: undefined });
  builder.addKill({ tick: 20, attacker: builder.players[5], victim: { steamid: '', name: '' } });
  builder.demo.deaths.push({ tick: undefined });
  const model = buildMatchModel(builder.finalize());
  assert.equal(model.ready, true);
  assert.equal(model.rounds.length, 1);
});
