import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import coaching from '../ui/analysis/coaching.js';
import analysis from '../ui/analysis/match-analysis.js';

/*
 * Ruby koçluk köprüsü — JS tarafı (Aşama 7.2).
 *
 * Doğrulanan davranışlar:
 *   - metrik özeti yalnızca ölçülen değerleri içerir (null'lar gönderilmez)
 *   - availability/missing alanları Ruby'nin hangi kuralı atlayacağını belirler
 *   - normalizeNotes bilinmeyen/kategorisiz notu atar
 *   - core köprüsü yoksa veya hata verirse ekran kırılmaz (status: unavailable/error)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const basic = fixture('basic-match');
const model = () => analysis.buildMatchModel(basic);

test('metrik özeti maç geneli sayıları üretir', () => {
  const summary = coaching.buildCoachingSummary(model(), {});
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.scope, 'match');
  assert.equal(summary.player, null);
  assert.equal(summary.metrics.rounds, 8);
  assert.equal(summary.metrics.tick_rate, 64);
  assert.equal(summary.metrics.kills, 55);
  assert.equal(summary.metrics.opening_attempts, 8);
  assert.equal(summary.metrics.opening_success_percent, 87.5);
  assert.equal(summary.metrics.eco_rounds, 3);
  assert.equal(summary.metrics.force_win_rate, 0);
  // Ekonomi ve utility verisi var → ilgili gruplar açık
  assert.equal(summary.availability.economy, true);
  assert.equal(summary.availability.utility, true);
});

test('entry trade oranı entry ölümleri üzerinden hesaplanır (tüm ölümler değil)', () => {
  const summary = coaching.buildCoachingSummary(model(), {});
  assert.equal(summary.metrics.entry_deaths, 8, 'round başına bir entry ölümü');
  assert.equal(summary.metrics.entry_traded, 7);
  assert.equal(summary.metrics.entry_trade_rate, 0.875);
  // 1'in üzerinde bir "oran" üretilemez (totrals.tradedDeaths yanlış payda olurdu)
  assert.ok(summary.metrics.entry_trade_rate <= 1);
});

test('eksik metrik gönderilmez ve missing listesine yazılır', () => {
  const summary = coaching.buildCoachingSummary(model(), {});
  assert.ok(summary.missing.includes('avg_crosshair_error_deg'), 'tick state yok → crosshair hatası yok');
  assert.equal(summary.metrics.avg_crosshair_error_deg, undefined);
  assert.equal(summary.metrics.potential_reaction_ms, undefined);

  // Kill konumları yoksa mesafe metriği hiç üretilmez (0/0 uydurulmaz)
  const positionless = JSON.parse(JSON.stringify(basic));
  for (const death of positionless.deaths) {
    for (const key of ['attacker_X', 'attacker_Y', 'user_X', 'user_Y']) delete death[key];
  }
  const withoutPositions = coaching.buildCoachingSummary(analysis.buildMatchModel(positionless), {});
  assert.ok(withoutPositions.missing.includes('avg_kill_distance'));
  assert.equal(withoutPositions.metrics.avg_kill_distance, undefined);
  // headshot_percent konum gerektirmez → aim grubu açık kalır, yalnızca
  // mesafe/crosshair kuralları Ruby tarafında nil metrik nedeniyle atlanır.
  assert.equal(withoutPositions.availability.aim, true);
});

test('oyuncu seçildiğinde özet o oyuncuya daralır', () => {
  const steamId = '76561198000000006'; // foxtrot
  const summary = coaching.buildCoachingSummary(model(), { playerSteamId: steamId });
  assert.equal(summary.scope, 'player');
  assert.equal(summary.player.steamId, steamId);
  assert.equal(summary.metrics.kills, summary.metrics.kills); // sayısal
  assert.equal(summary.metrics.entry_deaths, 4, 'yalnızca foxtrot’un entry ölümleri');
  assert.equal(summary.metrics.opening_attempts, 4, 'yalnızca foxtrot’un açtığı düellolar');
  const matchWide = coaching.buildCoachingSummary(model(), {});
  assert.ok(summary.metrics.kills < matchWide.metrics.kills);
});

test('normalizeNotes: kategori bilinmeyen notu atar, eski etiketleri eşler', () => {
  const notes = coaching.normalizeNotes({
    engine: 'ruby-rules-v2',
    notes: [
      { severity: 'high', category: 'aim', tag: 'crosshair', text: 'A' },
      { severity: 'low', tag: 'entry', text: 'eski etiket' },
      { severity: 'critical', category: 'economy', text: 'bilinmeyen önem' },
      { category: 'utility', text: '' },
      { severity: 'medium', category: 'bilinmeyen', text: 'kategori yok' },
      'string not'
    ]
  });
  assert.equal(notes.length, 3);
  // Önem sırası: high → medium → low (motor sıralamasına güvenilmez)
  assert.deepEqual(notes[0], { severity: 'high', category: 'aim', tag: 'crosshair', text: 'A', metric: null });
  assert.equal(notes[1].severity, 'low');
  assert.equal(notes[2].severity, 'low');
  const byCategory = Object.fromEntries(notes.map((note) => [note.category, note]));
  assert.equal(byCategory.entry.tag, 'entry', 'eski entry etiketi korunur, kategoriye çevrilir');
  assert.equal(byCategory.economy.severity, 'low', 'bilinmeyen önem low’a düşer');
});

test('core köprüsü yoksa istek unavailable döner (throw değil)', async () => {
  const saved = globalThis.matchframe;
  delete globalThis.matchframe;
  try {
    const result = await coaching.requestCoaching(coaching.buildCoachingSummary(model(), {}));
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.notes, []);
    assert.match(result.message, /Core köprüsü/);
  } finally {
    if (saved) globalThis.matchframe = saved;
  }
});

test('Ruby motoru not döndürürse status ok, hata dönerse unavailable', async () => {
  const saved = globalThis.matchframe;

  globalThis.matchframe = {
    core: {
      request: async (action, payload) => {
        assert.equal(action, 'ruby_analyze');
        assert.ok(payload.metrics.rounds > 0);
        return {
          ok: true,
          data: {
            engine: 'ruby-rules-v2',
            notes: [
              { severity: 'high', category: 'utility', tag: 'flash', text: 'Flash assist yok', metric: 'flash_assists' }
            ],
            evaluated: 11,
            skipped: ['crosshair_error']
          }
        };
      }
    }
  };
  const ok = await coaching.requestCoaching(coaching.buildCoachingSummary(model(), {}));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.engine, 'ruby-rules-v2');
  assert.equal(ok.notes.length, 1);
  assert.equal(ok.notes[0].category, 'utility');
  assert.equal(ok.evaluated, 11);
  assert.deepEqual(ok.skipped, ['crosshair_error']);

  globalThis.matchframe = {
    core: { request: async () => ({ ok: false, error: 'Ruby runtime unavailable' }) }
  };
  const failed = await coaching.requestCoaching(coaching.buildCoachingSummary(model(), {}));
  assert.equal(failed.status, 'unavailable');
  assert.match(failed.message, /Ruby runtime unavailable/);

  globalThis.matchframe = {
    core: { request: async () => { throw new Error('IPC kapandı'); } }
  };
  const thrown = await coaching.requestCoaching(coaching.buildCoachingSummary(model(), {}));
  assert.equal(thrown.status, 'unavailable');
  assert.match(thrown.message, /IPC kapandı/);

  // Motor var ama not listesi yok → sessizce unavailable (ekran kırılmaz)
  globalThis.matchframe = {
    core: { request: async () => ({ ok: true, data: { running: false } }) }
  };
  const empty = await coaching.requestCoaching(coaching.buildCoachingSummary(model(), {}));
  assert.equal(empty.status, 'unavailable');
  assert.match(empty.message, /etkin değil/);

  if (saved) globalThis.matchframe = saved;
  else delete globalThis.matchframe;
});

test('ensure() aynı model için tek istek yapar, model değişince yeniler', async () => {
  const saved = globalThis.matchframe;
  let calls = 0;
  globalThis.matchframe = {
    core: {
      request: async () => {
        calls += 1;
        return { ok: true, data: { engine: 'ruby-rules-v2', notes: [] } };
      }
    }
  };
  coaching.reset();
  try {
    const first = coaching.ensure(model(), {});
    assert.equal(first.status, 'loading');
    coaching.ensure(model(), {});
    coaching.ensure(model(), {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 1, 'aynı model için ikinci istek atılmaz');
    assert.equal(coaching.getState().status, 'ok');
    assert.match(coaching.getState().message, /kural tetiklenmedi/);

    coaching.ensure(model(), { playerSteamId: '76561198000000001' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 2, 'oyuncu seçimi değişince yeni istek');
  } finally {
    coaching.reset();
    if (saved) globalThis.matchframe = saved;
    else delete globalThis.matchframe;
  }
});
