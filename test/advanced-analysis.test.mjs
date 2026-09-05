import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analysis from '../ui/analysis/match-analysis.js';
import advanced from '../ui/analysis/advanced-analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const {
  buildEconomyModel, buildSideSplitModel, buildMomentumModel, buildMatchHeatmap,
  buildOpeningDuels, classifyBuy
} = advanced;
const { buildMatchModel } = analysis;

const basic = fixture('basic-match');
const model = () => buildMatchModel(basic);

function team(model2, name) {
  return model2.teams.find((entry) => entry.name === name);
}

test('item_purchase yoksa ekonomi unavailable, uyarı üretir', () => {
  const empty = buildEconomyModel(buildMatchModel({ header: {}, players: [], roundMeta: [] }));
  assert.equal(empty.available, false);
  assert.equal(empty.availability.purchases, 'unavailable');

  const demo = { ...basic, purchases: null };
  const result = buildEconomyModel(buildMatchModel(demo));
  assert.equal(result.available, false);
  assert.match(result.warnings.join(' '), /item_purchase/);
});

test('round bazında harcama ve alım sınıflandırması', () => {
  const economy = buildEconomyModel(model());
  assert.equal(economy.available, true);
  assert.equal(economy.rounds.length, 8);

  const [first, second, third, fourth] = economy.rounds;
  // R1: 5x400 T + 5x500 CT (pistol round)
  assert.equal(first.bySide.T.spend, 2000);
  assert.equal(first.bySide.CT.spend, 2500);
  assert.equal(first.bySide.T.buy, 'pistol');
  assert.equal(first.bySide.CT.buy, 'pistol');
  assert.equal(first.winnerSide, 'T');

  // R2: T eco (300/kişi), CT full (4200/kişi)
  assert.equal(second.bySide.T.buy, 'eco');
  assert.equal(second.bySide.CT.buy, 'full');
  assert.equal(second.bySide.T.spendPerPlayer, 300);
  assert.equal(second.wonByHigherSpend, true, 'fazla harcayan CT kazandı');

  assert.equal(third.bySide.T.buy, 'full');
  assert.equal(fourth.bySide.T.buy, 'eco'); // 1000/kişi < 1500 eco eşiği
  assert.equal(Math.round(fourth.spendDelta), 5000 - 19000);

  // R5: T 2000/kişi -> force
  assert.equal(economy.rounds[4].bySide.T.buy, 'force');
  assert.equal(economy.rounds[4].bySide.CT.buy, 'full');
});

test('alım eşikleri yapılandırılabilir', () => {
  assert.equal(classifyBuy(800, { buy: { eco: 1500, full: 4000 }, pistolRoundNumbers: [] }), 'eco');
  assert.equal(classifyBuy(2500, { buy: { eco: 1500, full: 4000 }, pistolRoundNumbers: [] }), 'force');
  assert.equal(classifyBuy(4500, { buy: { eco: 1500, full: 4000 }, pistolRoundNumbers: [] }), 'full');

  const economy = buildEconomyModel(model(), { config: { buy: { eco: 500, full: 5000 } } });
  assert.equal(economy.thresholds.buy.eco, 500);
  assert.equal(economy.rounds[1].bySide.T.buy, 'eco');
  assert.equal(economy.rounds[1].bySide.CT.buy, 'force', '4200 yeni eşikte full değil');
});

test('takım ve oyuncu ekonomi özeti', () => {
  const economy = buildEconomyModel(model());
  const total = economy.teams.reduce((sum, entry) => sum + entry.spend, 0);
  assert.equal(Math.round(total), Math.round(economy.totals.spend));
  assert.equal(economy.teams.length, 2);
  for (const entry of economy.teams) {
    assert.equal(entry.rounds, 8, 'her takım her roundda bir tarafta');
    const buyTotal = Object.values(entry.byBuy).reduce((sum, value) => sum + value, 0);
    assert.equal(buyTotal, 8);
  }

  const players = economy.players;
  assert.equal(players.length, 10);
  // Round 1'de T tarafındaki oyuncular 400, CT tarafındakiler 500 harcar
  const first = players[0];
  assert.ok(first.spend > 0 && first.roundsPlayed === 8);
  assert.equal(first.avgSpend, first.spend / 8);
});

test('taraf dağılımı: takım bazında T/CT ayrımı', () => {
  const split = buildSideSplitModel(model());
  assert.equal(split.available, true);
  const anka = split.teams.find((entry) => entry.name === 'Team Anka');
  assert.equal(anka.T.rounds, 4);
  assert.equal(anka.CT.rounds, 4, 'devre arası sonrası taraf değişimi');
  assert.equal(anka.T.wins + anka.T.losses, 4);
  assert.ok(anka.T.adr > 0 && anka.CT.adr > 0, 'ADR taraf bazında hesaplanmalı');
  assert.equal(anka.T.entryKills + anka.CT.entryKills > 0, true);

  // Toplam kill iki tarafın toplamına eşit
  const totalKills = split.teams.reduce((sum, entry) => sum + entry.T.kills + entry.CT.kills, 0);
  assert.equal(totalKills, split.totals.T.kills + split.totals.CT.kills);
});

test('taraf dağılımı: oyuncu bazında ve devre arası', () => {
  const split = buildSideSplitModel(model());
  const player = split.players.find((entry) => entry.name === 'alpha');
  assert.equal(player.T.rounds, 4);
  assert.equal(player.CT.rounds, 4);
  assert.ok(player.T.kills + player.CT.kills > 0);
  for (const side of ['T', 'CT']) {
    assert.equal(player[side].kd, player[side].deaths > 0 ? player[side].kills / player[side].deaths : player[side].kills);
  }
});

test('momentum: skor farkı ve seriler', () => {
  const momentum = buildMomentumModel(model());
  assert.equal(momentum.available, true);
  assert.equal(momentum.rounds.length, 8);
  const last = momentum.rounds.at(-1);
  assert.equal(last.scoreT, 3);
  assert.equal(last.scoreCT, 5);
  assert.equal(last.diff, -2);
  assert.ok(momentum.longestStreak.T >= 2, 'T en az 2 roundlık seri yapmalı');
  assert.equal(momentum.biggestLead.round != null, true);
});

test('round verisi yoksa momentum ve taraf dağılımı boş döner', () => {
  const empty = buildMatchModel({ header: {}, players: [], roundMeta: [] });
  const momentum = buildMomentumModel(empty);
  assert.equal(momentum.available, false);
  assert.match(momentum.warnings.join(' '), /Round verisi/);
  const split = buildSideSplitModel(empty);
  assert.equal(split.available, false);
});

test('ısı haritası: kill ve ölüm noktaları', () => {
  const heatmap = buildMatchHeatmap(model());
  assert.equal(heatmap.available, true);
  assert.ok(heatmap.points.length > 0);
  const kinds = new Set(heatmap.points.map((point) => point.kind));
  assert.ok(kinds.has('kill') && kinds.has('death'), 'hem kill hem ölüm noktası olmalı');
  for (const point of heatmap.points) {
    assert.equal(typeof point.x, 'number');
    assert.equal(typeof point.y, 'number');
  }
});

test('konum yoksa ısı haritası unavailable', () => {
  const demo = JSON.parse(JSON.stringify(basic));
  for (const kill of demo.deaths) {
    delete kill.attacker_X; delete kill.attacker_Y; delete kill.attacker_Z;
    delete kill.user_X; delete kill.user_Y; delete kill.user_Z;
    delete kill.X; delete kill.Y; delete kill.Z;
  }
  const heatmap = buildMatchHeatmap(buildMatchModel(demo));
  assert.equal(heatmap.available, false);
  assert.match(heatmap.warnings.join(' '), /konum/i);
});

test('opening düellolar: taraf dağılımı ve round ilişkisi', () => {
  const openings = buildOpeningDuels(model());
  assert.equal(openings.available, true);
  assert.equal(openings.duels.length, 8, 'her roundda bir entry kill');
  const [first] = openings.duels;
  assert.equal(first.attackerName, 'alpha');
  assert.equal(first.victimName, 'foxtrot');
  assert.equal(first.attackerSide, 'T');
  assert.equal(first.victimSide, 'CT');
  assert.equal(first.headshot, true);
  assert.equal(first.roundWonByAttackerSide, true);

  const totalAttempts = openings.bySide.T.attempts + openings.bySide.CT.attempts;
  assert.equal(totalAttempts, 8);
  assert.ok(openings.bySide.T.successPercent != null);
});
