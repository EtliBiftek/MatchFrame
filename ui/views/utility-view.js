/*
 * Utility ekranı — Aşama 5 öncesi iskelet + mevcut veriden özet.
 *
 * demo-worker utility lifecycle eventlerini zaten çıkarıyor; bu yüzden
 * ekran, tam modül gelmeden de "atılan utility" özetini gösterebilir.
 * Radar overlay ve etkinlik skorları Aşama 5'te eklenecek.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const { el, clear } = ns.dom;
  const components = ns.components;

  const PLANNED = [
    'Başarılı / boşa kullanılan utility ayrımı',
    'Flash assist, kör edilen rakip ve takım arkadaşı sayısı',
    'Ortalama körlük süresi ve utility damage',
    'Smoke kapsama süresi, molotov alan kontrolü',
    'Radar üzerinde utility heatmap ve replay oynatma',
    'Round başında elde kalan / ölürken kullanılmayan utility'
  ];

  let container = null;
  let dirty = true;

  function utilityRows(model) {
    const filter = ns.filters.get();
    return model.playerOrder
      .map((steamId) => model.players[steamId])
      .filter(Boolean)
      .filter((player) => filter.side === 'all' || player.side === filter.side)
      .map((player) => {
        const utility = player.totals.utility || {};
        const total = Object.values(utility).reduce((sum, value) => sum + (Number(value) || 0), 0);
        return {
          steamId: player.steamId,
          name: player.name || player.steamId,
          team: player.teamName || player.side || '—',
          smoke: utility.smoke || 0,
          flash: utility.flash || 0,
          he: utility.he || 0,
          molotov: utility.molotov || 0,
          decoy: utility.decoy || 0,
          total
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  function render() {
    if (!container) return;
    clear(container);

    if (ns.store.status !== 'ready' || !ns.store.isReady()) {
      container.appendChild(components.noDemo(
        'Utility analizi için önce bir demo yükle.',
        () => root.MatchFrameBridge?.openDemo?.()
      ));
      dirty = false;
      return;
    }

    const model = ns.store.getModel();
    const rows = utilityRows(model);
    const utilityAvailable = Boolean(model.availability.utility?.available);
    const totalEvents = model.events.utility?.length || 0;

    const body = el('div', { class: 'view-body' });

    body.appendChild(el('section', { class: 'block' }, [
      el('header', { class: 'block-head' }, [el('h2', { class: 'block-title', text: 'Utility özeti (ön izleme)' })]),
      el('div', { class: 'block-body' }, [
        components.statGrid([
          components.statCard({ label: 'Toplam utility', value: totalEvents, hint: 'detonate/start eventleri' }),
          components.statCard({ label: 'Smoke', value: rows.reduce((sum, row) => sum + row.smoke, 0) }),
          components.statCard({ label: 'Flash', value: rows.reduce((sum, row) => sum + row.flash, 0) }),
          components.statCard({ label: 'HE', value: rows.reduce((sum, row) => sum + row.he, 0) }),
          components.statCard({ label: 'Molotov', value: rows.reduce((sum, row) => sum + row.molotov, 0) }),
          components.statCard({ label: 'Kör etme', value: model.events.blinds?.length || 0, hint: 'player_blind' })
        ])
      ])
    ]));

    body.appendChild(el('section', { class: 'block' }, [
      el('header', { class: 'block-head' }, [el('h2', { class: 'block-title', text: 'Oyuncu bazında atılan utility' })]),
      el('div', { class: 'block-body' }, [
        components.dataTable({
          columns: [
            { key: 'name', label: 'Oyuncu' },
            { key: 'team', label: 'Takım' },
            { key: 'smoke', label: 'Smoke', align: 'right' },
            { key: 'flash', label: 'Flash', align: 'right' },
            { key: 'he', label: 'HE', align: 'right' },
            { key: 'molotov', label: 'Molotov', align: 'right' },
            { key: 'decoy', label: 'Decoy', align: 'right' },
            { key: 'total', label: 'Toplam', align: 'right' }
          ],
          rows,
          emptyText: utilityAvailable ? 'Bu demoda utility eventi bulunamadı' : 'Utility eventleri parse edilemedi',
          caption: 'Yalnızca detonasyon/başlangıç eventleri sayılır'
        })
      ])
    ]));

    body.appendChild(el('section', { class: 'block' }, [
      el('header', { class: 'block-head' }, [el('h2', { class: 'block-title', text: 'Yol haritası' })]),
      el('div', { class: 'block-body' }, [
        components.emptyState({
          kind: 'planned',
          title: 'Tam utility modülü Aşama 5’te geliştirilecek',
          message: 'Radar overlay, etkinlik skorları ve replay bağlantıları bu ekrana eklenecek.',
          details: PLANNED.map((item) => `• ${item}`)
        })
      ])
    ]));

    if (!utilityAvailable && model.availability.utility?.error) {
      body.appendChild(el('div', { class: 'data-notes' }, [
        el('span', { class: 'data-notes-title', text: 'Veri durumu' }),
        el('span', { class: 'data-note', text: `utility: ${model.availability.utility.error}` })
      ]));
    }

    container.appendChild(body);
    dirty = false;
  }

  ns.views.register({
    id: 'utility',
    label: 'Utility',
    mount(node) {
      container = node;
    },
    activate() {
      if (dirty || !container?.childElementCount) render();
    },
    invalidate() {
      dirty = true;
      if (ns.navigation.current() === 'utility') render();
    }
  });

  ns.bus.on('demo:changed', () => {
    dirty = true;
    if (ns.navigation.current() === 'utility') render();
  });
  ns.bus.on('demo:cleared', () => {
    dirty = true;
    if (ns.navigation.current() === 'utility') render();
  });
  ns.filters.subscribe(() => {
    dirty = true;
    if (ns.navigation.current() === 'utility') render();
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
