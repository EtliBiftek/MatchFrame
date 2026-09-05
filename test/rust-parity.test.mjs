import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analysis from '../ui/analysis/match-analysis.js';
import bridge from '../ui/analysis/rust-bridge.js';

/*
 * JS ↔ Rust model eşitliği (Aşama 8).
 *
 * Rust motoru `analysis-rs` cargo özelliğiyle derlenir:
 *   cargo build --manifest-path backend/Cargo.toml --release --features analysis-rs
 *
 * Test, binary yolu `MF_CORE_BIN` ile verildiğinde çalışır; aksi halde atlanır.
 * Örnek (Windows):
 *   $env:MF_CORE_BIN = "backend\\target\\release\\matchframe-core.exe"; npm test
 *
 * Karşılaştırılan alanlar yalnızca Rust modülünün hesapladığı alanlar
 * (bkz. coverage.deferred): round sayısı + round başına kill/ölüm/hasar,
 * oyuncu toplamları (kill/ölüm/hasar/ADR/headshot), takım toplamları.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const BIN = process.env.MF_CORE_BIN || '';

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

function request(bin, action, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Rust core yanıt vermedi (zaman aşımı)'));
    }, 20000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split('\n').find((entry) => entry.trim().startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      child.kill();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Rust çıktısı JSON değil: ${line.slice(0, 200)}`));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) reject(new Error(`Rust core çıktı üretmedi (code ${code}) ${stderr.slice(0, 200)}`));
    });
    child.stdin.write(`${JSON.stringify({ id: 1, action, payload })}\n`);
  });
}

const enabled = Boolean(BIN) && fs.existsSync(BIN);
const skipReason = enabled ? false : 'MF_CORE_BIN tanımlı değil (analysis-rs derlemesi yok)';

test('Rust modeli JS modeliyle aynı sayıları üretir', { skip: skipReason }, async () => {
  const demo = fixture('basic-match');
  const js = analysis.buildMatchModel(demo);
  const response = await request(BIN, bridge.ACTION, bridge.payloadFor(demo));
  assert.equal(response.ok, true, response.error);
  const rust = response.data;

  assert.equal(rust.engine, 'rust');
  assert.equal(rust.schemaVersion, 1);
  assert.equal(rust.match.roundsPlayed, js.rounds.length);
  assert.equal(rust.rounds.length, js.rounds.length);

  // Round başına kill / ölüm / hasar
  for (let index = 0; index < rust.rounds.length; index += 1) {
    const rustRound = rust.rounds[index];
    const jsRound = js.rounds[index];
    assert.equal(rustRound.number, jsRound.number, `round ${index} numarası`);
    assert.equal(rustRound.kills, (jsRound.kills || []).length, `round ${jsRound.number} kill`);
    assert.equal(rustRound.deaths, (jsRound.kills || []).length, `round ${jsRound.number} ölüm`);
    const jsDamage = Math.round((jsRound.damage || []).reduce((total, event) => total + (Number(event.damage) || 0), 0));
    assert.equal(Math.round(rustRound.damage), jsDamage, `round ${jsRound.number} hasar`);
  }

  // Oyuncu toplamları
  for (const rustPlayer of rust.players) {
    const jsPlayer = js.players[rustPlayer.steamId];
    assert.ok(jsPlayer, `Rust bilinmeyen oyuncu döndürdü: ${rustPlayer.steamId}`);
    assert.equal(rustPlayer.totals.kills, jsPlayer.totals.kills, `${rustPlayer.name} kill`);
    assert.equal(rustPlayer.totals.deaths, jsPlayer.totals.deaths, `${rustPlayer.name} ölüm`);
    assert.equal(rustPlayer.totals.headshotKills, jsPlayer.totals.headshotKills, `${rustPlayer.name} headshot`);
    assert.ok(Math.abs(rustPlayer.totals.damage - jsPlayer.totals.damage) <= 1, `${rustPlayer.name} hasar`);
    if (jsPlayer.totals.adr != null) {
      assert.ok(Math.abs((rustPlayer.totals.adr ?? 0) - jsPlayer.totals.adr) <= 1, `${rustPlayer.name} ADR`);
    }
  }

  // Takım toplamları (takımlar üye listesiyle eşleştirilir)
  for (const rustTeam of rust.teams) {
    const members = [...rustTeam.players].sort().join(',');
    const jsTeam = js.teams.find((team) => [...team.players].sort().join(',') === members);
    assert.ok(jsTeam, `Rust bilinmeyen takım döndürdü: ${rustTeam.name}`);
    assert.equal(rustTeam.name, jsTeam.name, 'takım adı');
    assert.equal(rustTeam.totals.kills, jsTeam.totals.kills, `${rustTeam.name} kill`);
    assert.equal(rustTeam.totals.deaths, jsTeam.totals.deaths, `${rustTeam.name} ölüm`);
    assert.equal(rustTeam.totals.headshotKills, jsTeam.totals.headshotKills, `${rustTeam.name} headshot`);
    assert.ok(Math.abs((rustTeam.totals.adr ?? 0) - (jsTeam.totals.adr ?? 0)) <= 1, `${rustTeam.name} ADR`);
  }
});

test('Rust modeli taşınmayan alanları gizlemez, coverage.deferred içinde listeler', { skip: skipReason }, async () => {
  const demo = fixture('basic-match');
  const response = await request(BIN, bridge.ACTION, bridge.payloadFor(demo));
  const rust = response.data;
  assert.equal(rust.partial, true, 'model kısmi olduğunu saklamamalı');
  assert.ok(Array.isArray(rust.coverage.deferred), 'coverage.deferred yok');
  for (const field of ['round winner inference', 'entry / trade detection', 'clutch detection']) {
    assert.ok(rust.coverage.deferred.includes(field), `${field} deferred listesinde yok`);
  }
  // Round kazananı taşınmadı → null (uydurulmuş kazanan yok)
  assert.equal(rust.rounds[0].winnerSide, null);
});

test('özellik kapalıysa action açıklayıcı hata döner (JS modeline düşülür)', { skip: skipReason }, async () => {
  const response = await request(BIN, 'backend_info', {});
  assert.equal(response.ok, true);
  const hasFeature = Boolean(response.data?.analysis_rs);
  if (hasFeature) {
    const built = await request(BIN, bridge.ACTION, bridge.payloadFor(fixture('basic-match')));
    assert.equal(built.ok, true);
  } else {
    const failed = await request(BIN, bridge.ACTION, bridge.payloadFor(fixture('basic-match')));
    assert.equal(failed.ok, false);
    assert.match(failed.error, /analysis-rs/);
  }
});

test('köprü payload’dan frames’i çıkarır', () => {
  const payload = bridge.payloadFor({
    header: {}, players: [], roundMeta: [], deaths: [], damage: [],
    frames: new Array(10).fill({}), bounds: {}, cameraTracks: [], tickRate: 64
  });
  assert.equal(payload.frames, undefined);
  assert.equal(payload.bounds, undefined);
  assert.equal(payload.tickRate, 64);
  assert.deepEqual(payload.roundMeta, []);
});
