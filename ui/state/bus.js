/*
 * MatchFrame — olay bus'ı.
 *
 * Eski replay kodu global fonksiyon override'larıyla çalışıyor. Yeni sol panel
 * ekranları bu zincire dokunmadan, yalnızca bu bus üzerinden haberleşir.
 */
(function (root) {
  'use strict';
  const handlers = new Map();

  const bus = {
    on(type, handler) {
      if (typeof type !== 'string' || typeof handler !== 'function') return () => {};
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => bus.off(type, handler);
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[MF bus] ${type} işlenirken hata`, error);
        }
      }
    }
  };

  const ns = (root.MF = root.MF || {});
  ns.bus = bus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
