import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/harness.mjs';

/* Aim ekranı entegrasyon testleri: üç durum, filtreler, sütun gizleme, replay. */

async function bootAim(fixtureName = 'aim-duel') {
  const ui = await boot();
  await ui.loadDemo(ui.fixture(fixtureName));
  ui.MF.filters.set({ playerSteamId: '', weapon: 'all' });
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');
  return { ui, view };
}

function cards(view) {
  return [...view.querySelectorAll('.stat-card')].map((card) => ({
    label: card.querySelector('.stat-label').textContent,
    value: card.querySelector('.stat-value').textContent,
    hint: card.querySelector('.stat-hint')?.textContent || ''
  }));
}

/* Kapsayıcı veya doğrudan <table> verilebilir. */
function headers(scope) {
  return [...scope.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
}

test('demo yokken aim ekranı demo yükleme mesajı gösterir', async () => {
  const ui = await boot();
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');
  assert.match(view.textContent, /demo yükle/i);
  assert.equal(view.querySelectorAll('.stat-card').length, 0);
  ui.close();
});

test('kill/atış verisi olmayan demoda metrik uyarısı çıkar', async () => {
  const ui = await boot();
  const demo = ui.fixture('aim-duel');
  await ui.loadDemo({ ...demo, deaths: null, shots: null });
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');
  assert.equal(view.querySelectorAll('.stat-card').length, 0);
  assert.match(view.textContent, /sağlamıyor/i);
  ui.close();
});

test('aim ekranı özet kartlarını çizer', async () => {
  const { ui, view } = await bootAim();
  const summary = cards(view);

  const kill = summary.find((card) => card.label === 'Kill');
  assert.equal(kill.value, '2');
  assert.match(kill.hint, /1 headshot/);

  const hs = summary.find((card) => card.label === 'HS %');
  assert.equal(hs.value, '50%');

  const accuracy = summary.find((card) => card.label === 'Accuracy');
  assert.equal(accuracy.value, '%67'); // 4/6 isabet

  const distance = summary.find((card) => card.label === 'Ort. kill mesafesi');
  assert.match(distance.value, /1175 u/);

  const moving = summary.find((card) => card.label === 'Hareket halinde atış');
  assert.equal(moving.value, '%33');

  const crosshair = summary.find((card) => card.label === 'Crosshair açı hatası');
  assert.equal(crosshair.value, '2,5°');
  assert.match(crosshair.hint, /kabul edilebilir|çok iyi/);

  const reaction = summary.find((card) => card.label === 'Potential reaction');
  assert.equal(reaction.value, '750 ms');
  assert.match(reaction.hint, /kesin tepki süresi değil/);
  ui.close();
});

test('silah tablosu ve oyuncu tablosu çizilir', async () => {
  const { ui, view } = await bootAim();
  const tables = [...view.querySelectorAll('.data-table')];
  assert.ok(tables.length >= 2, 'silah ve oyuncu tablosu yok');

  const weaponHeaders = headers(tables[0]);
  for (const label of ['Silah', 'Kill', 'HS', 'Atış', 'İsabet', 'İsabet %']) {
    assert.ok(weaponHeaders.includes(label), `${label} sütunu yok`);
  }
  const rows = [...tables[0].querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
  const ak = rows.find((row) => row[0] === 'AK-47');
  assert.ok(ak, 'AK-47 satırı yok');
  assert.equal(ak[1], '1');   // kill
  assert.equal(ak[2], '1');   // headshot
  assert.equal(ak[4], '85');  // hasar
  assert.equal(ak[5], '4');   // atış
  assert.equal(ak[6], '3');   // isabet
  assert.equal(ak[7], '%75'); // isabet %

  const awp = rows.find((row) => row[0] === 'AWP');
  assert.equal(awp[5], '2');
  assert.equal(awp[6], '1');
  assert.equal(awp[7], '%50');

  const playerHeaders = headers(tables[1]);
  for (const label of ['Oyuncu', 'K', 'HS %', 'Hasar', 'ADR', 'Atış', 'İsabet %', 'Mesafe', 'Hareket %', 'Açı hatası', 'Reaction*']) {
    assert.ok(playerHeaders.includes(label), `${label} sütunu yok`);
  }
  ui.close();
});

test('düello listesi replay’e atlar', async () => {
  const { ui, view } = await bootAim();
  const rows = [...view.querySelectorAll('.event-row')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /alpha → bravo/);
  assert.match(rows[0].textContent, /AK-47/);
  assert.match(rows[0].textContent, /HS/);
  assert.match(rows[0].textContent, /reaction\* 750 ms/);

  const button = [...rows[0].querySelectorAll('button')].find((node) => node.textContent.trim() === 'Replay');
  ui.click(button);
  assert.equal(ui.MF.navigation.current(), 'replay');
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 120, 'konuma girişten yarım saniye öncesine gitmeli');
  ui.close();
});

test('tick state yoksa kamera/hareket kartları "—" gösterir', async () => {
  const ui = await boot();
  const demo = ui.fixture('aim-duel');
  await ui.loadDemo({ ...demo, frames: [] });
  ui.MF.filters.set({ playerSteamId: '', weapon: 'all' });
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');
  const summary = cards(view);
  assert.equal(summary.find((card) => card.label === 'Hareket halinde atış').value, '—');
  assert.equal(summary.find((card) => card.label === 'Crosshair açı hatası').value, '—');
  assert.equal(summary.find((card) => card.label === 'Potential reaction').value, '—');
  assert.match(view.textContent, /tick state yok/);

  const playerHeaders = headers([...view.querySelectorAll('.data-table')][1]);
  assert.equal(playerHeaders.includes('Açı hatası'), false);
  assert.equal(playerHeaders.includes('Reaction*'), false);
  assert.equal(playerHeaders.includes('Hareket %'), false);
  ui.close();
});

test('bullet_impact yoksa accuracy kartı ve sütunları gizlenir', async () => {
  const ui = await boot();
  const demo = ui.fixture('aim-duel');
  await ui.loadDemo({ ...demo, impacts: null });
  ui.MF.filters.set({ playerSteamId: '', weapon: 'all' });
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');

  const accuracy = cards(view).find((card) => card.label === 'Accuracy');
  assert.equal(accuracy.value, '—');
  assert.match(accuracy.hint, /bullet_impact yok/);

  const tables = [...view.querySelectorAll('.data-table')];
  assert.equal(headers(tables[0]).includes('İsabet %'), false);
  assert.equal(headers(tables[1]).includes('İsabet %'), false);
  assert.match(view.textContent, /bullet_impact/);
  ui.close();
});

test('weapon_fire yoksa atış sütunu gizlenir, kill verisi kalır', async () => {
  const ui = await boot();
  const demo = ui.fixture('aim-duel');
  await ui.loadDemo({ ...demo, shots: null, impacts: null });
  ui.MF.filters.set({ playerSteamId: '', weapon: 'all' });
  ui.go('aim');
  const view = ui.document.getElementById('view-aim');
  const tables = [...view.querySelectorAll('.data-table')];
  assert.equal(headers(tables[0]).includes('Atış'), false);
  assert.equal(cards(view).find((card) => card.label === 'Kill').value, '2');
  assert.match(view.textContent, /weapon_fire/);
  ui.close();
});

test('round filtresi düello listesini daraltır', async () => {
  const { ui, view } = await bootAim();
  ui.setSelect('#globalRoundFilter', '1');
  const rows = [...view.querySelectorAll('.event-row')];
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /alpha → bravo/);
  assert.equal(cards(view).find((card) => card.label === 'Kill').value, '2', 'özet filtreden bağımsız kalır');
  ui.close();
});

test('ısı haritası canvas’ı çizilir', async () => {
  const { ui, view } = await bootAim();
  const canvas = view.querySelector('canvas.radar-canvas');
  assert.ok(canvas, 'ısı haritası canvas’ı yok');
  assert.match(view.querySelector('.radar-legend').textContent, /İsabet/);
  assert.match(view.querySelector('.radar-legend').textContent, /Kill/);
  ui.close();
});

test('doğruluk sınırları bloğu visibility uyarısını içerir', async () => {
  const { ui, view } = await bootAim();
  const notes = view.querySelector('.data-notes');
  assert.ok(notes, 'not bloğu yok');
  assert.match(notes.textContent, /Visibility/);
  ui.close();
});
