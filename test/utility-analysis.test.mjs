import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analysis from '../ui/analysis/match-analysis.js';
import utilityAnalysis from '../ui/analysis/utility-analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const { buildUtilityModel, inventoryGrenades } = utilityAnalysis;
const { buildMatchModel } = analysis;

const utilityFixture = fixture('utility-heavy');
const utilityModel = () => buildUtilityModel(buildMatchModel(utilityFixture), { frames: utilityFixture.frames });

function byName(model, name) {
  return model.players.find((player) => player.name === name);
}

test('model yoksa utility modeli boş döner, çökmez', () => {
  const model = buildUtilityModel(null);
  assert.equal(model.available, false);
  assert.equal(model.players.length, 0);
  assert.equal(model.availability.utility, 'unavailable');
  assert.equal(model.warnings.length, 0);

  const empty = buildUtilityModel(buildMatchModel({ header: {}, players: [], roundMeta: [] }));
  assert.equal(empty.available, false);
  assert.equal(empty.warnings.length >= 1, true);
});

test('utility verisi olmayan demoda uyarı metni döner', () => {
  const missing = fixture('missing-events');
  const model = buildUtilityModel(buildMatchModel(missing));
  assert.equal(model.available, false);
  assert.match(model.warnings.join(' '), /parse edilmedi/i);
});

test('atılan utility sayıları: expire eventleri çift sayılmaz', () => {
  const model = utilityModel();
  assert.equal(model.available, true);
  // 4 smoke + 5 flash + 3 HE + 2 molotov + 1 decoy
  assert.deepEqual(model.totals.thrown, { smoke: 4, flash: 5, he: 3, molotov: 2, decoy: 1, total: 15 });
  assert.deepEqual(byName(model, 'alpha').thrown, { smoke: 2, flash: 2, he: 0, molotov: 0, decoy: 0, total: 4 });
  assert.deepEqual(byName(model, 'charlie').thrown, { smoke: 0, flash: 0, he: 1, molotov: 1, decoy: 0, total: 2 });
});

test('flash: düşman/takım arkadaşı ayrımı ve boşa atış oranı', () => {
  const model = utilityModel();
  const bravo = byName(model, 'bravo');
  assert.equal(bravo.flash.thrown, 2);
  assert.equal(bravo.flash.enemiesBlinded, 1); // attacker alanı olmayan kayıt fallback ile bağlandı
  assert.equal(bravo.flash.teammatesBlinded, 1);
  assert.equal(bravo.flash.attributedByFallback, 1);
  assert.equal(bravo.flash.enemiesBlindSeconds, 1.8);
  assert.equal(bravo.flash.teammateBlindSeconds, 3);
  assert.equal(bravo.flash.wasted, 0);
  assert.equal(bravo.confidence, 'medium'); // fallback çıkarım güveni düşürür

  const alpha = byName(model, 'alpha');
  assert.equal(alpha.flash.thrown, 2);
  assert.equal(alpha.flash.enemiesBlinded, 1);
  assert.equal(alpha.flash.wasted, 1); // 2100 tick'teki boşa flash
  assert.equal(alpha.flash.wastedRate, 50);

  const delta = byName(model, 'delta');
  assert.equal(delta.flash.enemiesPerFlash, 2);
  assert.equal(delta.flash.wasted, 0);

  assert.equal(model.totals.flash.enemiesBlinded, 4);
  assert.equal(model.totals.flash.teammatesBlinded, 1);
  assert.equal(model.totals.flash.wasted, 1);
});

test('player_blind attacker alanı yoksa uyarı üretir', () => {
  const model = utilityModel();
  assert.equal(model.warnings.length, 1);
  assert.match(model.warnings[0], /attacker alanı yoktu/);
});

test('smoke süresi sadece expire varsa bilinir, bilinmeyen ayrı sayılır', () => {
  const model = utilityModel();
  const alpha = byName(model, 'alpha');
  assert.equal(alpha.smoke.thrown, 2);
  assert.equal(alpha.smoke.expireSecondsKnown, 2);
  assert.equal(alpha.smoke.expireSecondsUnknown, 0);
  assert.equal(alpha.smoke.activeSeconds, (1400 / 64) + (1200 / 64));

  const bravo = byName(model, 'bravo');
  assert.equal(bravo.smoke.thrown, 1);
  assert.equal(bravo.smoke.expireSecondsKnown, 0);
  assert.equal(bravo.smoke.expireSecondsUnknown, 1);
  assert.equal(bravo.smoke.avgActiveSeconds, null); // tahmin üretilmez
  assert.equal(bravo.smoke.cutRate, 100);

  assert.equal(model.availability.smokes, 'full');
});

test('molotov yanma süresi ve hasarı inferno eventlerinden okunur', () => {
  const model = utilityModel();
  const charlie = byName(model, 'charlie');
  assert.equal(charlie.molotov.thrown, 1);
  assert.equal(charlie.molotov.damage, 30);
  assert.equal(charlie.molotov.playersBurned, 1);
  assert.equal(Math.round(charlie.molotov.burnSeconds * 100) / 100, 12.5);

  const echo = byName(model, 'echo');
  assert.equal(Math.round(echo.molotov.burnSeconds * 100) / 100, 9.38);
  assert.equal(echo.molotov.damage, 25);

  assert.equal(model.totals.molotov.damage, 55);
});

test('HE hasarı ve isabet istatistikleri', () => {
  const model = utilityModel();
  const charlie = byName(model, 'charlie');
  assert.equal(charlie.he.thrown, 1);
  assert.equal(charlie.he.damage, 127); // 85 + 42
  assert.equal(charlie.he.playersHit, 2);
  assert.equal(charlie.he.wasted, 0);
  assert.equal(charlie.he.avgDamagePerVictim, 63.5);

  const bravo = byName(model, 'bravo');
  assert.equal(bravo.he.thrown, 1);
  assert.equal(bravo.he.damage, 0);
  assert.equal(bravo.he.wasted, 1);
  assert.equal(bravo.he.wastedRate, 100);

  assert.equal(model.totals.he.damage, 187);
});

test('aldatıcı hasar: ölümden sonra düşen hasar ayrı raporlanır', () => {
  const model = utilityModel();
  const foxtrot = byName(model, 'foxtrot');
  assert.equal(foxtrot.damage.beforeKill, 44);
  assert.equal(foxtrot.damage.afterKill, 16);
  assert.equal(foxtrot.damage.killsWithTrailingDamage, 1);
  assert.equal(Math.round(foxtrot.damage.deceptivePct * 100) / 100, 26.67);
  assert.equal(foxtrot.damage.simple, 60); // HE hasarı ölümle ilişkisiz
});

test('inventory: round başında tutulan ve ölürken elde kalan utility', () => {
  const model = utilityModel();
  assert.equal(model.availability.frames, 'full');
  const alpha = byName(model, 'alpha');
  assert.equal(alpha.inventory.available, true);
  assert.equal(alpha.inventory.roundsWithUtility, 3);
  assert.equal(alpha.inventory.keptAtRoundEnd.total, 6); // 3 round x (smoke + flash)
  assert.equal(alpha.inventory.deathsWithUtility, 1);
  assert.equal(alpha.inventory.grenadesWastedOnDeath.total, 2);
  assert.equal(alpha.inventory.grenadesWastedOnDeath.flash, 1);

  const charlie = byName(model, 'charlie');
  assert.equal(charlie.inventory.keptAtRoundEnd.molotov, 3);
  assert.equal(charlie.inventory.deathsWithUtility, 0);
});

test('frames verilmezse inventory alanı unavailable kalır', () => {
  const model = buildUtilityModel(buildMatchModel(utilityFixture));
  assert.equal(model.availability.frames, 'unavailable');
  const alpha = byName(model, 'alpha');
  assert.equal(alpha.inventory.available, false);
  assert.equal(alpha.inventory.keptAtRoundEnd.total, 0);
  assert.equal(alpha.inventory.deathsWithUtility, 0);
});

test('round bazlı utility dağılımı takım tarafına göre ayrılır', () => {
  const model = utilityModel();
  const [first, second] = model.rounds;
  assert.equal(first.counts.total, 10);
  assert.equal(first.byTeam.T.total, 10);
  assert.equal(first.byTeam.CT.total, 0);
  assert.equal(second.byTeam.CT.total, 4);
  assert.equal(second.byTeam.T.total, 0);
  // Round 2'de ölüm var ve player_death.assistedflash yüzdesi 0
  assert.equal(second.flashAssists, 0);
});

test('inventoryGrenades hem string hem obje item adlarını tanır', () => {
  assert.equal(inventoryGrenades(['weapon_smokegrenade', 'weapon_flashbang']).total, 2);
  assert.equal(inventoryGrenades([{ name: 'weapon_incgrenade' }, { item_name: 'weapon_hegrenade' }]).molotov, 1);
  assert.equal(inventoryGrenades([{ item_name: 'weapon_hegrenade' }]).he, 1);
  assert.equal(inventoryGrenades(null).total, 0);
  assert.equal(inventoryGrenades(['weapon_ak47']).total, 0);
});
