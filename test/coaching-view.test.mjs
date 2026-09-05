import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/harness.mjs';

/*
 * Koçluk notu paneli — DOM tarafı (Aşama 7.2).
 *
 * Kabul kriteri: Ruby motoru yoksa / hata verirse ekran kırılmaz, yalnızca
 * açıklayıcı uyarı gösterir. Motor çalışınca notlar kategoriye göre görünür.
 */

const NOTES = [
  { severity: 'high', category: 'aim', tag: 'crosshair hatası', text: 'Crosshair hatan hedefin üzerinde.', metric: 'avg_crosshair_error_deg' },
  { severity: 'medium', category: 'utility', tag: 'flash assist yok', text: 'Flash assist üretmedin.', metric: 'flash_assists' },
  { severity: 'low', category: 'entry', tag: 'trade edilmeyen entry', text: 'Entry ölümleri trade edilmiyor.', metric: 'entry_trade_rate' },
  { severity: 'high', category: 'economy', tag: 'force buy', text: 'Force buy verimsiz.', metric: 'force_win_rate' }
];

function block(view, title) {
  return [...view.querySelectorAll('.block')]
    .find((node) => (node.querySelector('.block-title')?.textContent || '').toLowerCase().includes(title.toLowerCase()));
}

async function bootView(viewId, fixtureName = 'basic-match') {
  const ui = await boot();
  await ui.loadDemo(ui.fixture(fixtureName));
  ui.MF.filters.set({ playerSteamId: '' });
  ui.go(viewId);
  return ui;
}

function wait(ms = 60) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('analysis ekranı koçluk bloğunu çizer ve motor yoksa uyarı gösterir', async () => {
  const ui = await bootView('analysis');
  const view = ui.document.getElementById('view-analysis');
  const section = block(view, 'Koçluk notları');
  assert.ok(section, 'koçluk bloğu yok');

  // Harness IPC'si not listesi döndürmez → motor devre dışı sayılır.
  await wait();
  const coach = block(view, 'Koçluk notları');
  assert.match(coach.textContent, /Koçluk notları alınamadı/);
  assert.equal(coach.querySelectorAll('.coach-note').length, 0);

  // Ekranın geri kalanı sağlam
  assert.ok(block(view, 'Ekonomi'), 'analiz blokları hâlâ çizili');
  assert.ok(block(view, 'Opening'));
  ui.close();
});

test('analysis ekranı notları kategori filtresi olmadan listeler', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.MF.filters.set({ playerSteamId: '' });
  ui.window.matchframe.core.request = async () => ({
    ok: true,
    data: { engine: 'ruby-rules-v2', notes: NOTES, evaluated: 11, skipped: ['crosshair_error'] }
  });
  ui.go('analysis');
  await wait();

  const view = ui.document.getElementById('view-analysis');
  const section = block(view, 'Koçluk notları');
  const rows = section.querySelectorAll('.coach-note');
  assert.equal(rows.length, 4);
  // Önem sırası: high → medium → low
  assert.deepEqual([...rows].map((row) => row.querySelector('.coach-severity').textContent),
    ['Yüksek', 'Yüksek', 'Orta', 'Düşük']);
  assert.match(rows[0].textContent, /Crosshair hatan/);
  assert.match(section.textContent, /motor: ruby-rules-v2/);
  assert.match(section.textContent, /11 kural değerlendirildi/);
  assert.match(section.textContent, /1 kural veri eksikliği/);
  ui.close();
});

test('aim ekranı yalnızca aim kategorisini gösterir', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.MF.filters.set({ playerSteamId: '' });
  ui.window.matchframe.core.request = async () => ({
    ok: true,
    data: { engine: 'ruby-rules-v2', notes: NOTES }
  });
  ui.go('aim');
  await wait();

  const view = ui.document.getElementById('view-aim');
  const section = block(view, 'Koçluk notları');
  const rows = section.querySelectorAll('.coach-note');
  assert.equal(rows.length, 1, 'yalnızca aim notu');
  assert.match(rows[0].textContent, /Crosshair hatan/);
  ui.close();
});

test('utility ekranı yalnızca utility kategorisini gösterir, diğerlerini sayar', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.MF.filters.set({ playerSteamId: '' });
  ui.window.matchframe.core.request = async () => ({
    ok: true,
    data: { engine: 'ruby-rules-v2', notes: NOTES }
  });
  ui.go('utility');
  await wait();

  const view = ui.document.getElementById('view-utility');
  const section = block(view, 'Koçluk notları');
  const rows = section.querySelectorAll('.coach-note');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Flash assist/);

  // Motor yalnızca aim notu döndürürse utility ekranı "diğer ekranlarda" der
  ui.window.matchframe.core.request = async () => ({
    ok: true,
    data: { engine: 'ruby-rules-v2', notes: [NOTES[0]] }
  });
  ui.window.MF.analysis.coaching.refresh();
  await wait(120);

  const utilitySection = block(ui.document.getElementById('view-utility'), 'Koçluk notları');
  assert.equal(utilitySection.querySelectorAll('.coach-note').length, 0);
  assert.match(utilitySection.textContent, /Bu ekran için not yok/);
  assert.match(utilitySection.textContent, /Aim/, 'diğer notların kategorisi yazılır');
  ui.close();
});

test('motor hata verirse ekran uyarı gösterir, yeniden dene çalışır', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.MF.filters.set({ playerSteamId: '' });
  let fail = true;
  ui.window.matchframe.core.request = async () => (fail
    ? { ok: false, error: 'Ruby runtime unavailable' }
    : { ok: true, data: { engine: 'ruby-rules-v2', notes: [NOTES[1]] } });
  ui.go('analysis');
  await wait();

  const view = ui.document.getElementById('view-analysis');
  let section = block(view, 'Koçluk notları');
  assert.match(section.textContent, /Ruby runtime unavailable/);

  fail = false;
  const retry = [...section.querySelectorAll('button')].find((node) => node.textContent.includes('Yeniden dene'));
  assert.ok(retry, 'yeniden dene butonu yok');
  ui.click(retry);
  await wait(120);

  section = block(view, 'Koçluk notları');
  assert.equal(section.querySelectorAll('.coach-note').length, 1);
  assert.match(section.textContent, /Flash assist/);
  ui.close();
});

test('oyuncu seçimi değişince koçluk özeti yenilenir', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.MF.filters.set({ playerSteamId: '' });
  const scopes = [];
  ui.window.matchframe.core.request = async (action, payload) => {
    scopes.push(payload.scope);
    return { ok: true, data: { engine: 'ruby-rules-v2', notes: [] } };
  };
  ui.go('analysis');
  await wait();
  ui.go('utility');
  await wait();
  ui.setSelect('#globalPlayerFilter', '76561198000000001');
  await wait(120);

  assert.ok(scopes.includes('match'), 'maç geneli istek atıldı');
  assert.ok(scopes.includes('player'), 'oyuncu seçilince oyuncu kapsamlı istek atıldı');
  ui.close();
});
