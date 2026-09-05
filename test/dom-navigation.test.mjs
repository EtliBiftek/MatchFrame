import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/harness.mjs';

test('scriptler hatasız yüklenir ve MF namespace kurulur', async () => {
  const ui = await boot();
  assert.deepEqual(ui.errors, [], `script hataları: ${ui.errors.map((entry) => entry.error?.message).join(', ')}`);
  assert.ok(ui.MF, 'MF namespace yok');
  assert.ok(ui.MF.bus, 'bus yok');
  assert.ok(ui.MF.store, 'store yok');
  assert.ok(ui.MF.filters, 'filters yok');
  assert.ok(ui.MF.navigation, 'navigation yok');
  assert.ok(ui.MF.analysis?.buildMatchModel, 'analiz modülü yok');
  assert.ok(ui.MF.analysis?.buildUtilityModel, 'utility analiz modülü yok');
  ui.close();
});

test('rail butonları dört ekranı da değiştirir', async () => {
  const ui = await boot();
  assert.equal(ui.activeView(), 'replay');

  ui.click('.rail-item[data-view="analysis"]');
  assert.equal(ui.activeView(), 'analysis');
  assert.equal(ui.window.MF.navigation.current(), 'analysis');
  assert.equal(ui.document.querySelector('.rail-item[data-view="analysis"]').classList.contains('active'), true);
  assert.equal(ui.document.querySelector('.rail-item[data-view="replay"]').classList.contains('active'), false);

  ui.click('.rail-item[data-view="aim"]');
  assert.equal(ui.activeView(), 'aim');
  ui.click('.rail-item[data-view="utility"]');
  assert.equal(ui.activeView(), 'utility');

  ui.click('.rail-item[data-view="replay"]');
  assert.equal(ui.activeView(), 'replay');
  assert.equal(ui.document.getElementById('view-replay').hasAttribute('hidden'), false);
  assert.equal(ui.document.getElementById('view-analysis').hasAttribute('hidden'), true);
  ui.close();
});

test('demo yokken analiz ekranları boş durum gösterir', async () => {
  const ui = await boot();
  for (const id of ['analysis', 'aim', 'utility']) {
    ui.go(id);
    const view = ui.document.getElementById(`view-${id}`);
    assert.ok(view.querySelector('.empty-panel'), `${id} boş durum göstermiyor`);
    assert.match(view.textContent, /demo/i);
  }
  ui.close();
});

test('demo yüklenince analiz modeli bir kez kurulur', async () => {
  const ui = await boot();
  const demo = ui.fixture('basic-match');
  const model = await ui.loadDemo(demo);

  assert.equal(ui.MF.store.isReady(), true);
  assert.equal(model.match.roundsPlayed, 8);
  assert.equal(model.teams.length, 2);

  // Aynı demo tekrar yüklenirse model yeniden kurulmaz (cache).
  const first = model;
  await ui.loadDemo(demo);
  assert.equal(ui.MF.store.getModel(), first);
  ui.close();
});

test('analysis ekranı özet, takım, oyuncu ve round bölümlerini çizer', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.go('analysis');

  const view = ui.document.getElementById('view-analysis');
  const blocks = [...view.querySelectorAll('.block-title')].map((node) => node.textContent);
  assert.deepEqual(blocks, ['Özet', 'Takım karşılaştırması', 'Oyuncular', 'Round listesi', 'Maç olayları']);

  const cards = [...view.querySelectorAll('.stat-card')].map((node) => node.querySelector('.stat-label').textContent);
  assert.deepEqual(cards, ['Round', 'Toplam kill', 'Toplam ölüm', 'Plant', 'Defuse', 'Maç süresi']);
  assert.equal(view.querySelectorAll('.stat-card')[0].querySelector('.stat-value').textContent, '8');

  // Takım tablosu: 2 takım + başlık satırı
  const teamRows = view.querySelectorAll('.block:nth-of-type(2) tbody tr');
  assert.equal(teamRows.length, 2);

  // Oyuncu tablosu 10 satır çizer ve ADR sütunu hasar verisi olduğu için görünür
  const playerTable = view.querySelectorAll('.block:nth-of-type(3) .data-table')[0];
  assert.equal(playerTable.querySelectorAll('tbody tr').length, 10);
  const headers = [...playerTable.querySelectorAll('thead th')].map((node) => node.textContent.replace(/[▲▼]/g, '').trim());
  assert.ok(headers.includes('ADR'), `ADR sütunu yok: ${headers.join(',')}`);
  assert.ok(headers.includes('Entry'));
  assert.ok(headers.includes('Trade'));

  // Round listesi (4. blok)
  const roundRows = view.querySelectorAll('.block:nth-of-type(4) .event-row');
  assert.equal(roundRows.length, 8);
  assert.match(roundRows[0].textContent, /Round 1/);
  ui.close();
});

test('round filtresi analiz içeriğini daraltır', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.go('analysis');

  ui.setSelect('#globalRoundFilter', '3');
  assert.equal(ui.MF.filters.get().round, 3);

  const view = ui.document.getElementById('view-analysis');
  const cards = [...view.querySelectorAll('.stat-card')].map((node) => node.querySelector('.stat-label').textContent);
  assert.deepEqual(cards, ['Kazanan', 'Round süresi', 'Kill', 'Bomba', 'Clutch', 'İlk kill']);
  const clutchCard = view.querySelectorAll('.stat-card')[4];
  assert.equal(clutchCard.querySelector('.stat-value').textContent, '1v3');
  assert.equal(clutchCard.querySelector('.stat-hint').textContent, 'kazanıldı');

  const roundRows = view.querySelectorAll('.block:nth-of-type(4) .event-row');
  assert.equal(roundRows.length, 8, 'round listesi filtreden bağımsız kalır');

  ui.setSelect('#globalRoundFilter', 'all');
  assert.equal(ui.MF.filters.get().round, 'all');
  ui.close();
});

test('olaydan replay’e atlama: ekran değişir ve tick ayarlanır', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.go('analysis');

  const view = ui.document.getElementById('view-analysis');
  const replayButton = [...view.querySelectorAll('.block:nth-of-type(4) .event-row .btn')].find((button) => button.textContent === 'Replay');
  assert.ok(replayButton, 'Replay butonu yok');
  replayButton.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));

  assert.equal(ui.MF.navigation.current(), 'replay');
  assert.equal(ui.activeView(), 'replay');
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 1000);
  ui.close();
});

test('replay ekranından ayrılınca oynatma durur, tick korunur', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  ui.window.MatchFrameBridge.seek(4200);
  ui.click('#pauseBtn'); // çalıyor durumu
  assert.equal(ui.window.MatchFrameBridge.isPlaying(), true);

  ui.go('analysis');
  assert.equal(ui.window.MatchFrameBridge.isPlaying(), false);
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 4200);

  ui.go('replay');
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 4200, 'tick korunmalı');
  ui.close();
});

test('replay’de oyuncu seçimi analysis filtresine yansır', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));
  const steamId = ui.MF.store.getDemo().players[3].steamid;
  ui.window.MatchFrameBridge.selectSteamId(steamId);
  assert.equal(ui.MF.filters.get().playerSteamId, steamId);

  ui.go('analysis');
  ui.go('replay');
  assert.equal(ui.window.MatchFrameBridge.getSelectedSteamId(), steamId);
  ui.close();
});

test('eksik eventli demoda analiz ekranı veri durumunu raporlar', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('missing-events'));
  ui.go('analysis');

  const view = ui.document.getElementById('view-analysis');
  const headers = [...view.querySelectorAll('.block:nth-of-type(3) .data-table thead th')].map((node) => node.textContent.replace(/[▲▼]/g, '').trim());
  assert.equal(headers.includes('ADR'), false, 'hasar verisi yokken ADR sütunu gizlenmeli');

  const notes = view.querySelector('.data-notes');
  assert.ok(notes, 'veri durumu bloğu yok');
  assert.match(notes.textContent, /player_hurt/);
  ui.close();
});

test('utility ekranı mevcut veriden özet üretir, aim ekranı veri durumunu listeler', async () => {
  const ui = await boot();
  await ui.loadDemo(ui.fixture('basic-match'));

  ui.go('utility');
  const utilityView = ui.document.getElementById('view-utility');
  assert.equal(utilityView.querySelectorAll('.stat-card').length, 6);
  const utilityRows = utilityView.querySelectorAll('.data-table tbody tr');
  assert.ok(utilityRows.length >= 4, 'utility tablosu boş');

  ui.go('aim');
  const aimView = ui.document.getElementById('view-aim');
  const statuses = [...aimView.querySelectorAll('.data-table tbody tr')].map((row) => row.textContent);
  assert.ok(statuses.some((row) => /player_hurt|weapon_fire|bullet_impact/.test(row)));
  ui.close();
});

test('demo yüklenmemişken replay ekranı bozulmaz', async () => {
  const ui = await boot();
  ui.go('analysis');
  ui.go('replay');
  assert.equal(ui.activeView(), 'replay');
  assert.equal(ui.document.getElementById('replayCanvas') instanceof ui.window.HTMLCanvasElement, true);
  assert.deepEqual(ui.errors, []);
  ui.close();
});
