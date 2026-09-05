/*
 * Aim ekranı — iskelet.
 *
 * Plan gereği Aim modülü Analysis ve Utility'den sonra (Aşama 6) geliştirilir.
 * Bu dosya ekranın üç durumunu da doğru yönetir:
 *   1) demo yok      → "Analiz için bir demo yükle"
 *   2) metrik yok    → hangi eventlerin eksik olduğu açıkça gösterilir
 *   3) veri hazır    → Aşama 6'da gerçek aim bileşenleri gelecek
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const { el, clear } = ns.dom;
  const components = ns.components;

  const PLANNED = [
    'Headshot oranı ve silah bazında dağılım',
    'İlk mermi isabeti / accuracy (weapon_fire + bullet_impact)',
    'Crosshair placement: kamera yönü ile hedef yönü arasındaki açı farkı',
    'Potential reaction time (görüş konisine giriş → ilk atış)',
    'Spray süresi ve kontrolü',
    'Hareket halindeyken ateş etme',
    'Duel bazında replay tekrarı',
    'Aim heatmap (atış ve kill noktaları)'
  ];

  const REQUIRED_EVENTS = [
    { key: 'shots', label: 'weapon_fire', note: 'Atılan mermi ve silah bazında accuracy' },
    { key: 'impacts', label: 'bullet_impact', note: 'İsabet noktası ve crosshair hatası' },
    { key: 'damage', label: 'player_hurt', note: 'Hitgroup, hasar ve mesafe' },
    { key: 'kills', label: 'player_death', note: 'Headshot, duel sonucu' }
  ];

  let container = null;
  let dirty = true;

  function render() {
    if (!container) return;
    clear(container);

    if (ns.store.status !== 'ready' || !ns.store.isReady()) {
      container.appendChild(components.noDemo(
        'Aim analizi için önce bir demo yükle.',
        () => root.MatchFrameBridge?.openDemo?.()
      ));
      dirty = false;
      return;
    }

    const model = ns.store.getModel();
    const missing = REQUIRED_EVENTS.filter((entry) => !model.availability[entry.key]?.available);
    const ready = missing.length === 0;

    const rows = REQUIRED_EVENTS.map((entry) => {
      const status = model.availability[entry.key] || { available: false, error: 'bilinmiyor', count: 0 };
      return {
        label: entry.label,
        note: entry.note,
        count: status.available ? status.count : 0,
        status: status.available ? 'hazır' : status.error
      };
    });

    const body = el('div', { class: 'view-body' }, [
      el('section', { class: 'block' }, [
        el('header', { class: 'block-head' }, [el('h2', { class: 'block-title', text: 'Aim modülü' })]),
        el('div', { class: 'block-body' }, [
          components.emptyState({
            kind: ready ? 'planned' : 'no-data',
            title: ready ? 'Aim ekranı Aşama 6’da geliştirilecek' : 'Bu demo aim metrikleri için yeterli veri sağlamıyor',
            message: ready
              ? 'Gerekli eventler parse edildi. Aim bileşenleri Analysis ve Utility tamamlandıktan sonra bu ekrana bağlanacak.'
              : 'Aşağıdaki eventler eksik. Parser genişletmesi (Aşama 4) sonrası bu ekran otomatik olarak veri gösterecek.',
            details: PLANNED.map((item) => `• ${item}`)
          })
        ])
      ]),
      el('section', { class: 'block' }, [
        el('header', { class: 'block-head' }, [el('h2', { class: 'block-title', text: 'Veri durumu' })]),
        el('div', { class: 'block-body' }, [
          components.dataTable({
            columns: [
              { key: 'label', label: 'Event' },
              { key: 'note', label: 'Kullanım' },
              { key: 'count', label: 'Kayıt', align: 'right' },
              { key: 'status', label: 'Durum' }
            ],
            rows,
            emptyText: 'Veri yok'
          })
        ])
      ])
    ]);

    container.appendChild(body);
    dirty = false;
  }

  ns.views.register({
    id: 'aim',
    label: 'Aim',
    mount(node) {
      container = node;
    },
    activate() {
      if (dirty || !container?.childElementCount) render();
    },
    invalidate() {
      dirty = true;
      if (ns.navigation.current() === 'aim') render();
    }
  });

  ns.bus.on('demo:changed', () => {
    dirty = true;
    if (ns.navigation.current() === 'aim') render();
  });
  ns.bus.on('demo:cleared', () => {
    dirty = true;
    if (ns.navigation.current() === 'aim') render();
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
