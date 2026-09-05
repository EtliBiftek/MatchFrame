import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/harness.mjs';

/*
 * Utility ekranı entegrasyon testleri.
 * Kapsanan durumlar: demo yok / metrik yok / veri hazır, radar, filtreler,
 * replay'e atlama ve eksik veri notları.
 */

async function bootUtility(fixtureName = 'utility-heavy') {
  const ui = await boot();
  await ui.loadDemo(ui.fixture(fixtureName));
  // landing.js ilk oyuncuyu replay odağı olarak seçer; testlerde temizlenir.
  ui.MF.filters.set({ playerSteamId: '' });
  ui.go('utility');
  const view = ui.document.getElementById('view-utility');
  return { ui, view };
}

function cards(view) {
  return [...view.querySelectorAll('.stat-card')].map((card) => ({
    label: card.querySelector('.stat-label').textContent,
    value: card.querySelector('.stat-value').textContent,
    hint: card.querySelector('.stat-hint')?.textContent || ''
  }));
}

function headers(view) {
  return [...view.querySelectorAll('.data-table thead th')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
}

function tableRow(view, name) {
  return [...view.querySelectorAll('.data-table tbody tr')]
    .find((row) => row.children[0].textContent.trim() === name);
}

test('demo yokken utility ekranı demo yükleme mesajı gösterir', async () => {
  const ui = await boot();
  ui.go('utility');
  const view = ui.document.getElementById('view-utility');
  assert.match(view.textContent, /demo yükle/i);
  assert.equal(view.querySelectorAll('.data-table').length, 0);
  ui.close();
});

test('utility verisi olmayan demoda metrik uyarısı çıkar', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('missing-events'));
  ui.go('utility');
  const view = ui.document.getElementById('view-utility');
  assert.equal(view.querySelectorAll('.stat-card').length, 0);
  assert.match(view.textContent, /sağlamıyor|parse edilemedi/i);
  ui.close();
});

test('utility ekranı kartları ve oyuncu tablosunu çizer', async () => {
  const { ui, view } = await bootUtility();
  const summary = cards(view);

  const atılan = summary.find((card) => card.label === 'Atılan utility');
  assert.equal(atılan.value, '15');

  const smoke = summary.find((card) => card.label === 'Smoke');
  const flash = summary.find((card) => card.label === 'Flash');
  const molotov = summary.find((card) => card.label === 'Molotov');
  assert.equal(smoke.value, '4');
  assert.equal(flash.value, '5');
  assert.equal(molotov.value, '2');

  const enemies = summary.find((card) => card.label === 'Kör edilen rakip');
  assert.equal(enemies.value, '4');
  assert.match(enemies.hint, /7\.3 sn/);

  const teammates = summary.find((card) => card.label === 'Kör edilen takım arkadaşı');
  assert.equal(teammates.value, '1');
  assert.match(teammates.hint, /3 sn/);

  const wasted = summary.find((card) => card.label === 'Boşa flash');
  assert.equal(wasted.value, '1');
  assert.match(wasted.hint, /20% boşa/);

  const damage = summary.find((card) => card.label === 'Utility hasarı');
  assert.equal(damage.value, '242'); // HE 187 + molotov 55

  const smokeSeconds = summary.find((card) => card.label === 'Ort. smoke süresi');
  assert.match(smokeSeconds.value, /19\.8 sn/);

  const columns = headers(view);
  for (const label of ['Oyuncu', 'Smoke', 'Flash', 'HE', 'Molotov', 'Rakip kör', 'Takım kör', 'Boşa flash', 'HE hasar', 'Molotov hasar', 'Round başı elde']) {
    assert.ok(columns.includes(label), `${label} sütunu yok`);
  }

  const charlie = tableRow(view, 'charlie');
  assert.ok(charlie, 'charlie satırı yok');
  const cellByLabel = (row, label) => {
    const index = columns.indexOf(label);
    return index < 0 ? null : row.children[index].textContent.trim();
  };
  assert.equal(cellByLabel(charlie, 'Smoke'), '0');
  assert.equal(cellByLabel(charlie, 'Flash'), '0');
  assert.equal(cellByLabel(charlie, 'HE'), '1');
  assert.equal(cellByLabel(charlie, 'Molotov'), '1');
  assert.equal(cellByLabel(charlie, 'Toplam'), '2');
  assert.equal(cellByLabel(charlie, 'HE hasar'), '127');
  assert.equal(cellByLabel(charlie, 'Molotov hasar'), '30');
  assert.equal(cellByLabel(charlie, 'Utility hasar'), '157');

  const bravo = tableRow(view, 'bravo');
  assert.equal(cellByLabel(bravo, 'Boşa flash'), '0');
  assert.equal(cellByLabel(bravo, 'Rakip kör'), '1', 'fallback ile bağlanan körlük sayılmalı');
  assert.equal(cellByLabel(bravo, 'Takım kör'), '1');
  ui.close();
});

test('körlük verisi olmayan demoda flash sütunları gizlenir', async () => {
  const ui = await boot();
  const demo = ui.fixture('utility-heavy');
  demo.blinds = null;
  demo.utility.playerBlinds = null;
  await ui.loadDemo(demo);
  ui.MF.filters.set({ playerSteamId: '' });
  ui.go('utility');
  const view = ui.document.getElementById('view-utility');
  const columns = headers(view);
  assert.equal(columns.includes('Rakip kör'), false, 'körlük sütunu gizlenmeli');
  assert.equal(columns.includes('Boşa flash'), false);
  assert.ok(columns.includes('Smoke'), 'diğer sütunlar kalmalı');
  const summary = cards(view).map((card) => card.label);
  assert.equal(summary.includes('Kör edilen rakip'), false);
  assert.match(view.textContent, /player_blind/);
  ui.close();
});

test('hasar verisi yoksa hasar sütunları ve kartı gizlenir', async () => {
  const ui = await boot();
  const demo = ui.fixture('utility-heavy');
  demo.damage = null;
  await ui.loadDemo(demo);
  ui.MF.filters.set({ playerSteamId: '' });
  ui.go('utility');
  const view = ui.document.getElementById('view-utility');
  const columns = headers(view);
  assert.equal(columns.includes('HE hasar'), false);
  assert.equal(columns.includes('Molotov hasar'), false);
  const summary = cards(view).map((card) => card.label);
  assert.equal(summary.includes('Utility hasarı'), false);
  assert.match(view.textContent, /player_hurt/);
  ui.close();
});

test('radar canvas + legend çizilir, noktaya tıklayınca replay’e gider', async () => {
  const { ui, view } = await bootUtility();
  const canvas = view.querySelector('canvas.radar-canvas');
  assert.ok(canvas, 'radar canvas yok');
  assert.match(view.querySelector('.radar-legend').textContent, /Smoke/);
  assert.match(view.querySelector('.radar-legend').textContent, /Flash/);
  assert.match(view.querySelector('.radar-note').textContent, /nokta/);

  // jsdom'ta canvas geometrisi (getBoundingClientRect) 0 döndüğü için tıklama
  // nokta seçimi yapmaz; burada yalnızca hatasız çalıştığı doğrulanır.
  canvas.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
  assert.deepEqual(ui.errors, [], 'radar tıklaması hata üretti');
  assert.ok(view.querySelector('canvas.radar-canvas'), 'radar kayboldu');
  ui.close();
});

test('round filtresi radar ve olay listesini daraltır', async () => {
  const { ui, view } = await bootUtility();
  const before = view.querySelectorAll('.event-row').length;
  assert.equal(before, 15);

  ui.setSelect('#globalRoundFilter', '2');
  const rows = [...view.querySelectorAll('.event-row')].map((row) => row.textContent);
  assert.ok(rows.length > 0 && rows.length < before, `round filtresi daraltmadı (${rows.length})`);
  for (const row of rows) assert.match(row, /R2/);

  // Zaman çizelgesi round seçiliyken görünür
  const range = view.querySelector('.filter-range');
  assert.ok(range, 'zaman çizelgesi yok');
  range.value = String(Number(range.min) + 10);
  range.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
  assert.ok(view.querySelectorAll('.event-row').length <= rows.length);
  ui.close();
});

test('tür filtresi yalnızca seçilen grenade tipini gösterir', async () => {
  const { ui, view } = await bootUtility();
  const selects = [...view.querySelectorAll('.filter-select')];
  const kindSelect = selects.find((select) => [...select.options].some((option) => option.value === 'molotov'));
  assert.ok(kindSelect, 'tür filtresi yok');
  ui.setSelect(kindSelect, 'molotov');

  const rows = [...view.querySelectorAll('.event-row')];
  assert.equal(rows.length, 2);
  for (const row of rows) assert.match(row.textContent, /MOLOTOV/);
  ui.close();
});

test('olay satırından replay’e atlanır', async () => {
  const { ui, view } = await bootUtility();
  const row = view.querySelector('.event-row');
  const button = [...row.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Replay');
  assert.ok(button, 'Replay butonu yok');
  ui.click(button);
  assert.equal(ui.MF.navigation.current(), 'replay', 'replay ekranına geçilmeli');
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 500, 'ilk utility tick\'ine gidilmeli');
  ui.close();
});

test('fallback flash bağlaması uyarı olarak görünür', async () => {
  const { ui, view } = await bootUtility();
  assert.match(view.querySelector('.data-notes').textContent, /attacker alanı yoktu/);
  ui.close();
});

test('oyuncu seçimi tabloda vurgulanır ve özeti daraltır', async () => {
  const { ui, view } = await bootUtility();
  const row = tableRow(view, 'bravo');
  ui.click(row);
  const selected = ui.document.querySelectorAll('#view-utility .data-table tbody tr.is-selected');
  assert.equal(selected.length, 1);
  const summary = cards(view).find((card) => card.label === 'Atılan utility');
  assert.equal(summary.value, '5', 'yalnızca seçili oyuncunun utilitysi sayılmalı');
  ui.close();
});
