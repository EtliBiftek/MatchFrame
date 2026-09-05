import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/harness.mjs';

/* Analysis ekranının Aşama 7.1 bölümleri: ekonomi, taraf dağılımı, momentum,
   ısı haritası, opening düellolar + eksik veri davranışı. */

async function bootAnalysis(fixtureName = 'basic-match', mutate = null) {
  const ui = await boot();
  const demo = mutate ? mutate(ui.fixture(fixtureName)) : ui.fixture(fixtureName);
  await ui.loadDemo(demo);
  ui.MF.filters.set({ playerSteamId: '' });
  ui.go('analysis');
  return { ui, view: ui.document.getElementById('view-analysis') };
}

function block(view, title) {
  return [...view.querySelectorAll('.block')]
    .find((node) => (node.querySelector('.block-title')?.textContent || '').toLowerCase().includes(title.toLowerCase()));
}

function headers(scope) {
  return [...scope.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
}

test('ekonomi bölümü kart ve round tablosu çizer', async () => {
  const { ui, view } = await bootAnalysis();
  const section = block(view, 'Ekonomi');
  assert.ok(section, 'ekonomi bloğu yok');

  const labels = [...section.querySelectorAll('.stat-card .stat-label')].map((node) => node.textContent);
  for (const label of ['Toplam harcama', 'Full buy', 'Force buy', 'Eco']) {
    assert.ok(labels.includes(label), `${label} kartı yok`);
  }

  const table = section.querySelector('.data-table');
  assert.ok(table, 'ekonomi tablosu yok');
  const columns = headers(table);
  for (const column of ['Round', 'T harcama', 'T alım', 'CT harcama', 'CT alım', 'Kazanan']) {
    assert.ok(columns.includes(column), `${column} sütunu yok`);
  }
  const rows = [...table.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 8);
  const second = [...rows[1].children].map((cell) => cell.textContent.trim());
  assert.deepEqual([second[0], second[2], second[4], second[6]], ['2', 'Eco', 'Full', 'CT']);
  const first = [...rows[0].children].map((cell) => cell.textContent.trim());
  assert.equal(first[0], '1');          // round
  assert.equal(first[2], 'Pistol');     // T alım
  assert.equal(first[4], 'Pistol');     // CT alım
  assert.equal(first[6], 'T');          // kazanan
  ui.close();
});

test('item_purchase yoksa ekonomi bloğu uyarı gösterir', async () => {
  const { ui, view } = await bootAnalysis('basic-match', (demo) => ({ ...demo, purchases: null }));
  const section = block(view, 'Ekonomi');
  assert.ok(section, 'ekonomi bloğu yok');
  assert.match(section.textContent, /Ekonomi verisi yok/i);
  assert.equal(section.querySelectorAll('.data-table').length, 0);
  ui.close();
});

test('taraf dağılımı T/CT tablolarını çizer', async () => {
  const { ui, view } = await bootAnalysis();
  const section = block(view, 'Taraf dağılımı');
  const tables = [...section.querySelectorAll('.data-table')];
  assert.equal(tables.length, 2, 'takım + oyuncu tablosu olmalı');

  const teamColumns = headers(tables[0]);
  for (const column of ['Takım', 'Taraf', 'Round', 'W', 'K', 'D', 'ADR']) {
    assert.ok(teamColumns.includes(column), `${column} sütunu yok`);
  }
  const teamRows = [...tables[0].querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
  assert.equal(teamRows.length, 4, '2 takım x 2 taraf');
  const sides = teamRows.map((row) => row[1]).sort();
  assert.deepEqual(sides, ['CT', 'CT', 'T', 'T']);
  for (const row of teamRows) assert.equal(row[2], '4', 'her taraf 4 round');

  const playerColumns = headers(tables[1]);
  for (const column of ['Oyuncu', 'T round', 'T K', 'T ADR', 'CT round', 'CT K', 'CT ADR']) {
    assert.ok(playerColumns.includes(column), `${column} sütunu yok`);
  }
  assert.equal(tables[1].querySelectorAll('tbody tr').length, 10);
  ui.close();
});

test('momentum grafiği SVG olarak çizilir', async () => {
  const { ui, view } = await bootAnalysis();
  const section = block(view, 'Momentum');
  const svg = section.querySelector('svg.chart-svg');
  assert.ok(svg, 'momentum grafiği yok');
  assert.ok(svg.querySelectorAll('rect').length >= 8, 'round başına bir bar olmalı');
  assert.match(section.textContent, /En uzun seri/);
  assert.match(section.textContent, /En büyük fark/);
  ui.close();
});

test('ısı haritası canvas + legend çizer', async () => {
  const { ui, view } = await bootAnalysis();
  const section = block(view, 'Isı haritası');
  assert.ok(section.querySelector('canvas.radar-canvas'), 'ısı haritası canvas’ı yok');
  const legend = section.querySelector('.radar-legend').textContent;
  assert.match(legend, /Kill/);
  assert.match(legend, /Ölüm/);
  ui.close();
});

test('konum yoksa ısı haritası uyarı gösterir', async () => {
  const { ui, view } = await bootAnalysis('basic-match', (demo) => {
    const copy = JSON.parse(JSON.stringify(demo));
    for (const death of copy.deaths) {
      for (const key of ['attacker_X', 'attacker_Y', 'user_X', 'user_Y']) delete death[key];
    }
    return copy;
  });
  const section = block(view, 'Isı haritası');
  assert.match(section.textContent, /Isı haritası yok/i);
  assert.equal(section.querySelector('canvas.radar-canvas'), null);
  ui.close();
});

test('opening düellolar listesi ve taraf kartları', async () => {
  const { ui, view } = await bootAnalysis();
  const section = block(view, 'Opening');
  const labels = [...section.querySelectorAll('.stat-card .stat-label')].map((node) => node.textContent);
  assert.ok(labels.includes('T açılış üstünlüğü'));
  assert.ok(labels.includes('CT açılış üstünlüğü'));

  const rows = section.querySelectorAll('.event-row');
  assert.equal(rows.length, 8, 'her round için bir açılış');
  assert.match(rows[0].textContent, /alpha → foxtrot/);
  assert.match(rows[0].textContent, /HS/);

  const button = [...rows[0].querySelectorAll('button')].find((node) => node.textContent.trim() === 'Replay');
  ui.click(button);
  assert.equal(ui.MF.navigation.current(), 'replay');
  assert.equal(ui.window.MatchFrameBridge.getCurrentTick(), 1136, 'entry tick\'inden 1 sn öncesine gitmeli');
  ui.close();
});

test('round filtresi yeni bölümleri etkilemez (maç geneli metrikler)', async () => {
  const { ui, view } = await bootAnalysis();
  ui.setSelect('#globalRoundFilter', '3');
  const economyRows = block(view, 'Ekonomi').querySelectorAll('.data-table tbody tr').length;
  assert.equal(economyRows, 8, 'ekonomi tüm roundları listeler');
  const openings = block(view, 'Opening').querySelectorAll('.event-row').length;
  assert.equal(openings, 8);
  ui.close();
});
