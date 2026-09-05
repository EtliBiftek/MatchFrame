import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analysis from '../ui/analysis/match-analysis.js';
import aimAnalysis from '../ui/analysis/aim-analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const {
  buildAimModel, distance3, forwardVector, angleBetweenDeg, crosshairErrorDeg,
  isInViewCone, speedUnitsPerSecond, matchShotForImpact
} = aimAnalysis;
const { buildMatchModel } = analysis;

const aimDemo = fixture('aim-duel');
const aimModel = (options = {}) => buildAimModel(buildMatchModel(aimDemo), {
  frames: aimDemo.frames,
  ...options
});

function byName(model, name) {
  return model.players.find((player) => player.name === name);
}

test('geometri: ileri vektör ve açı hesabı', () => {
  const forward = forwardVector(0, 0);
  assert.equal(Math.round(forward.x), 1);
  assert.equal(Math.round(forward.y), 0);
  assert.equal(Math.round(forward.z), 0);

  const right = forwardVector(90, 0);
  assert.equal(Math.round(right.x), 0);
  assert.equal(Math.round(right.y), 1);

  assert.equal(Math.round(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })), 0);
  assert.equal(Math.round(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })), 90);
  assert.equal(Math.round(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })), 180);
  assert.equal(distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
});

test('crosshair açı hatası: tam nişan 0°, 5° sapma 5°', () => {
  const shooter = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  assert.equal(crosshairErrorDeg(shooter, { x: 1000, y: 0, z: 0 }), 0);

  const turned = { x: 0, y: 0, z: 0, yaw: 5, pitch: 0 };
  const error = crosshairErrorDeg(turned, { x: 1000, y: 0, z: 0 });
  assert.equal(Math.round(error * 100) / 100, 5);

  // 45° koni sınırı
  assert.equal(isInViewCone(shooter, { x: 1000, y: -1000, z: 0 }, 45), true);
  assert.equal(isInViewCone(shooter, { x: 1000, y: -1100, z: 0 }, 45), false);
});

test('hız: iki frame arası birim/saniye', () => {
  const speed = speedUnitsPerSecond({ tick: 0, x: 0, y: 0, z: 0 }, { tick: 64, x: 128, y: 0, z: 0 }, 64);
  assert.equal(speed, 128);
  assert.equal(speedUnitsPerSecond({ tick: 10, x: 0, y: 0, z: 0 }, { tick: 10, x: 5, y: 0, z: 0 }, 64), null);
});

test('isabet, kendisinden önceki en yakın atışa bağlanır', () => {
  const shots = [{ tick: 100, weapon: 'ak47' }, { tick: 164, weapon: 'awp' }];
  assert.equal(matchShotForImpact(shots, 100).weapon, 'ak47');
  assert.equal(matchShotForImpact(shots, 101).weapon, 'ak47');
  assert.equal(matchShotForImpact(shots, 165).weapon, 'awp');
  assert.equal(matchShotForImpact(shots, 200), null);
});

test('model yoksa aim modeli boş döner', () => {
  const model = buildAimModel(null);
  assert.equal(model.available, false);
  assert.equal(model.players.length, 0);
  assert.equal(model.duels.length, 0);
  assert.match(model.reason || '', /Demo|modeli/i);
});

test('kill ve atış verisi olmayan demoda metrik üretilmez', () => {
  const empty = buildMatchModel({ header: {}, players: [], roundMeta: [] });
  const model = buildAimModel(empty);
  assert.equal(model.available, false);
  assert.match(model.reason, /player_death|weapon_fire/);
});

test('aim-duel: atış, isabet ve accuracy', () => {
  const model = aimModel();
  assert.equal(model.available, true);
  assert.deepEqual(model.availability, {
    frames: 'full', shots: 'full', impacts: 'full', damage: 'full', kills: 'full'
  });

  const alpha = byName(model, 'alpha');
  assert.equal(alpha.shots, 4);
  assert.equal(alpha.impacts, 3);
  assert.equal(alpha.accuracy, 75);
  assert.equal(alpha.kills, 1);
  assert.equal(alpha.headshots, 1);
  assert.equal(alpha.headshotPercent, 100);

  const weapons = alpha.weapons.find((entry) => entry.key === 'ak47');
  assert.equal(weapons.shots, 4);
  assert.equal(weapons.hits, 3);
  assert.equal(weapons.kills, 1);
  assert.equal(Math.round(weapons.accuracy), 75);

  const charlie = byName(model, 'charlie');
  assert.equal(charlie.shots, 2);
  assert.equal(charlie.impacts, 1);
  assert.equal(charlie.accuracy, 50);
});

test('aim-duel: kill mesafesi konum verisinden hesaplanır', () => {
  const model = aimModel();
  assert.equal(Math.round(byName(model, 'alpha').avgKillDistance), 1000);
  assert.equal(Math.round(byName(model, 'charlie').avgKillDistance), 1302);
  assert.equal(byName(model, 'bravo').avgKillDistance, null, 'kill almayan oyuncuda mesafe yok');
});

test('aim-duel: crosshair açı hatası frame kamera açısından okunur', () => {
  const model = aimModel();
  const alpha = byName(model, 'alpha');
  assert.equal(alpha.crosshairErrorDeg, 0, 'yaw 0, hedef +X → hata 0');
  assert.equal(alpha.crosshairSamples, 1);

  const charlie = byName(model, 'charlie');
  assert.equal(Math.round(charlie.crosshairErrorDeg * 100) / 100, 5, 'yaw 5° → hata 5°');
});

test('aim-duel: hareket halinde atış oranı', () => {
  const model = aimModel();
  assert.equal(byName(model, 'alpha').movingShotRate, 0, 'sabit duran nişancı');
  assert.equal(byName(model, 'charlie').movingShotRate, 100, 'yürüyerek atan nişancı');
  assert.equal(Math.round(model.totals.movingShotRate * 10) / 10, 33.3);
});

test('aim-duel: potential reaction time yalnızca koniye giriş biliniyorsa', () => {
  const model = aimModel();
  const alpha = byName(model, 'alpha');
  assert.equal(alpha.potentialReactionMs, 750); // (200 - 152) / 64 * 1000
  assert.equal(alpha.reactionSamples, 1);

  // Hedef zaten koni içinde: giriş anı bilinmediği için tahmin üretilmez
  const charlie = byName(model, 'charlie');
  assert.equal(charlie.potentialReactionMs, null);
  assert.equal(charlie.reactionSamples, 0);
});

test('düello listesi: silah, mesafe, hasar, replay hedefi', () => {
  const model = aimModel();
  assert.equal(model.duels.length, 2);

  const [first, second] = model.duels;
  assert.equal(first.attackerName, 'alpha');
  assert.equal(first.victimName, 'bravo');
  assert.equal(first.weapon, 'ak47');
  assert.equal(first.headshot, true);
  assert.equal(Math.round(first.distance), 1000);
  assert.equal(first.shotCount, 4);
  assert.equal(first.damage, 85);
  assert.equal(first.visibleTick, 152);
  assert.equal(first.potentialReactionMs, 750);
  assert.equal(first.clamped, false);
  assert.equal(first.reactionReason, 'ok');
  assert.ok(first.jumpTick < first.tick, 'replay hedefi olaydan önceye gitmeli');

  assert.equal(second.attackerName, 'charlie');
  assert.equal(second.weapon, 'awp');
  assert.equal(second.clamped, true);
  assert.equal(second.reactionReason, 'target-already-visible');
  assert.equal(second.potentialReactionMs, null);
});

test('frames verilmezse kamera/hareket metrikleri null kalır', () => {
  const model = buildAimModel(buildMatchModel(aimDemo));
  assert.equal(model.availability.frames, 'unavailable');
  assert.match(model.warnings.join(' '), /Tick state yok/);

  const alpha = byName(model, 'alpha');
  assert.equal(alpha.crosshairErrorDeg, null);
  assert.equal(alpha.potentialReactionMs, null);
  assert.equal(alpha.movingShotRate, null);
  assert.equal(alpha.confidence, 'medium');
  // Atış/isabet frame'e bağlı değil
  assert.equal(alpha.accuracy, 75);
  assert.equal(model.duels.length, 2);
  assert.equal(model.duels[0].crosshairErrorDeg, null);
  assert.equal(model.duels[0].reactionReason, 'no-frames');
});

test('bullet_impact yoksa accuracy hesaplanmaz', () => {
  const demo = { ...aimDemo, impacts: null };
  const model = buildAimModel(buildMatchModel(demo), { frames: demo.frames });
  assert.equal(model.availability.impacts, 'unavailable');
  assert.match(model.warnings.join(' '), /bullet_impact/);
  assert.equal(byName(model, 'alpha').accuracy, null);
  assert.equal(model.totals.accuracy, null);
  assert.equal(byName(model, 'alpha').weapons[0].accuracy, null);
});

test('weapon_fire yoksa atış sayısı ve hareket oranı boş kalır', () => {
  const demo = { ...aimDemo, shots: null };
  const model = buildAimModel(buildMatchModel(demo), { frames: demo.frames });
  assert.equal(model.availability.shots, 'unavailable');
  assert.match(model.warnings.join(' '), /weapon_fire/);
  assert.equal(byName(model, 'alpha').shots, 0);
  assert.equal(byName(model, 'alpha').movingShotRate, null);
  assert.equal(byName(model, 'alpha').kills, 1, 'kill verisi etkilenmemeli');
});

test('thresholds yapılandırılabilir, varsayılanlar korunur', () => {
  const model = aimModel();
  assert.deepEqual(model.thresholds.crosshair, { great: 2, ok: 5, weak: 10 });
  assert.equal(model.thresholds.duelWindowSeconds, 12);

  const custom = aimModel({ config: { crosshair: { great: 1 }, duelWindowSeconds: 4 } });
  assert.equal(custom.thresholds.crosshair.great, 1);
  assert.equal(custom.thresholds.crosshair.weak, 10, 'belirtilmeyen eşik korunur');
  assert.equal(custom.thresholds.duelWindowSeconds, 4);
});
