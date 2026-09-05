import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Ruby kural motoru (backend/analytics/analyze.rb) — girdi/çıktı sözleşmesi.
 *
 * Sistemde `ruby` varsa çalışır (CI'da Ruby 3.4 kurulu), yoksa atlanır:
 * JS tarafı Ruby olmadan da çalışmak zorunda.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SCRIPT = path.join(ROOT, 'backend', 'analytics', 'analyze.rb');

const probe = spawnSync('ruby', ['-v'], { encoding: 'utf8' });
const hasRuby = probe.status === 0;

function run(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('ruby', [SCRIPT], { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `ruby hata verdi: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const RICH = {
  metrics: {
    rounds: 12,
    kills: 22,
    deaths: 30,
    headshot_percent: 18,
    entry_deaths: 9,
    entry_traded: 2,
    entry_trade_rate: 0.22,
    avg_crosshair_error_deg: 8.4,
    potential_reaction_ms: 620,
    avg_kill_distance: 1250,
    flash_assists: 0,
    enemies_blinded: 2,
    teammates_blinded: 4,
    utility_thrown: 5,
    eco_rounds: 1,
    force_rounds: 4,
    force_win_rate: 0.2,
    opening_attempts: 7,
    opening_success_percent: 28
  },
  availability: { entry: true, aim: true, utility: true, economy: true, opening: true },
  scope: 'player'
};

test('ruby kural motoru not üretir (ruby yoksa atlanır)', { skip: hasRuby ? false : 'ruby çalıştırılabilir dosyası yok' }, () => {
  const output = run(RICH);
  assert.equal(output.engine, 'ruby-rules-v2');
  assert.equal(output.schemaVersion, 2);
  assert.ok(output.notes.length >= 6, `beklenenden az not: ${output.notes.length}`);

  const categories = new Set(output.notes.map((note) => note.category));
  for (const category of ['aim', 'entry', 'utility', 'economy', 'positioning']) {
    assert.ok(categories.has(category), `${category} kategorisi üretilmedi`);
  }

  // Önem sırası: high → medium → low
  const rank = { high: 0, medium: 1, low: 2 };
  const ranks = output.notes.map((note) => rank[note.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'notlar önem sırasına dizilmedi');

  // En kriteri: crosshair hatası 8.4° → high
  const crosshair = output.notes.find((note) => note.metric === 'avg_crosshair_error_deg');
  assert.equal(crosshair.severity, 'high');
  assert.match(crosshair.text, /crosshair/i);

  const entry = output.notes.find((note) => note.metric === 'entry_trade_rate');
  assert.equal(entry.severity, 'high');
  assert.match(entry.text, /22/);

  const opening = output.notes.find((note) => note.metric === 'opening_success_percent');
  assert.equal(opening.category, 'positioning');

  for (const note of output.notes) {
    assert.ok(['high', 'medium', 'low'].includes(note.severity), `geçersiz önem: ${note.severity}`);
    assert.ok(note.text && note.text.length > 10, 'not metni boş');
  }
});

test('veri yoksa kural değerlendirilmez, tahmin üretilmez', { skip: hasRuby ? false : 'ruby çalıştırılabilir dosyası yok' }, () => {
  const output = run({ metrics: { rounds: 8 }, availability: {}, scope: 'match' });
  assert.equal(output.engine, 'ruby-rules-v2');
  assert.deepEqual(output.notes, [], 'veri yokken not üretilmemeli');
  assert.equal(output.evaluated, 0);
  assert.ok(output.skipped.length >= 10, `${output.skipped.length} kural atlanmalıydı`);
});

test('kısmi veri: yalnızca ölçülen metriklerin kuralları çalışır', { skip: hasRuby ? false : 'ruby çalıştırılabilir dosyası yok' }, () => {
  const output = run({
    metrics: { rounds: 10, avg_crosshair_error_deg: 5.1 },
    availability: { aim: true, entry: false, utility: false, economy: false, opening: false }
  });
  assert.equal(output.notes.length, 1);
  assert.equal(output.notes[0].metric, 'avg_crosshair_error_deg');
  assert.equal(output.notes[0].severity, 'medium');
  assert.ok(output.skipped.length >= 8, 'diğer kurallar atlanmalıydı');
  assert.ok(!output.skipped.includes('crosshair_error'));
});

test('bozuk girdi motoru çökertmez', { skip: hasRuby ? false : 'ruby çalıştırılabilir dosyası yok' }, () => {
  const output = run('{bu json değil');
  assert.equal(output.engine, 'ruby-rules-v2');
  assert.deepEqual(output.notes, []);
});

test('script dosyası mevcut ve çalıştırılabilir bayrağı okunabilir', () => {
  assert.ok(fs.existsSync(SCRIPT), 'backend/analytics/analyze.rb yok');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /ruby-rules-v2/);
  assert.match(source, /STDIN\.read/);
});
