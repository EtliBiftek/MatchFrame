/*
 * MatchFrame — uygulama kabuğu: view kaydı ve rail navigasyonu.
 *
 * Kurallar:
 *  - Aktif rail butonu işaretlenir, yalnızca ilgili ekran görünür.
 *  - Ekranlar mount edildikten sonra tekrar tekrar kurulmaz.
 *  - Replay state'i (tick, seçili oyuncu, POV) ekran değişse de korunur.
 *  - Analiz ekranlarında POV/Babylon motoru çalıştırılmaz.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const bus = ns.bus;

  const registry = new Map();
  const order = [];
  let currentId = null;
  let containerStack = null;

  const views = {
    registry,
    order,
    register(view) {
      if (!view?.id) return null;
      registry.set(view.id, view);
      if (!order.includes(view.id)) order.push(view.id);
      return view;
    },
    get(id) {
      return registry.get(id) || null;
    },
    list() {
      return order.map((id) => registry.get(id)).filter(Boolean);
    }
  };

  const navigation = {
    initialized: false,

    current() {
      return currentId;
    },

    go(id, options = {}) {
      const view = registry.get(id);
      if (!view) return false;
      if (id === currentId && !options.force) {
        view.activate?.(options);
        return true;
      }

      const previous = currentId ? registry.get(currentId) : null;
      previous?.deactivate?.();

      for (const entry of views.list()) {
        const node = entry.container || document.getElementById(`view-${entry.id}`);
        if (!node) continue;
        entry.container = node;
        const isActive = entry.id === id;
        node.classList.toggle('is-active', isActive);
        node.toggleAttribute('hidden', !isActive);
        if (isActive && !entry.mounted) {
          entry.mounted = true;
          try {
            entry.mount?.(node);
          } catch (error) {
            console.error(`[MF] ${entry.id} ekranı kurulamadı`, error);
          }
        }
      }

      for (const button of document.querySelectorAll('.rail-item[data-view]')) {
        const isActive = button.dataset.view === id;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-current', isActive ? 'page' : 'false');
      }

      currentId = id;
      if (containerStack) containerStack.dataset.activeView = id;
      document.body.dataset.view = id;

      try {
        view.activate?.(options);
      } catch (error) {
        console.error(`[MF] ${id} ekranı etkinleştirilemedi`, error);
      }
      bus.emit('view:changed', { id, previous: previous?.id || null });
      return true;
    },

    init() {
      containerStack = document.getElementById('viewStack');
      if (!containerStack) return navigation;
      navigation.initialized = true;
      for (const button of document.querySelectorAll('.rail-item[data-view]')) {
        if (button.dataset.mfNavBound === '1') continue;
        button.dataset.mfNavBound = '1';
        button.type = 'button';
        button.setAttribute('aria-label', button.dataset.label || button.dataset.view);
        button.addEventListener('click', () => navigation.go(button.dataset.view));
      }
      const initial = document.querySelector('.rail-item.active[data-view]')?.dataset.view || 'replay';
      navigation.go(initial, { force: true });
      return navigation;
    }
  };

  ns.views = views;
  ns.navigation = navigation;

  /*
   * Script'ler HTML içinde satır içi olduğunda DOMContentLoaded tüm view'lar
   * kaydolduktan sonra tetiklenir. Geç yüklenen senaryolarda (test harness,
   * dinamik script ekleme) init ayrıca çağrılabilir; çağrı idempotenttir.
   */
  function scheduleInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => navigation.init(), { once: true });
      return;
    }
    setTimeout(() => navigation.init(), 0);
  }

  scheduleInit();
})(typeof globalThis !== 'undefined' ? globalThis : this);
