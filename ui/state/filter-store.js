/*
 * MatchFrame — ekranlar arası paylaşılan filtre durumu.
 *
 * Replay ekranında seçilen oyuncu buraya yansır; Analysis/Aim/Utility ekranları
 * aynı seçimi kullanır. Filtre değişimi replay state'ini silmez.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const bus = ns.bus;

  const state = {
    playerSteamId: '',
    round: 'all', // 'all' | round number
    side: 'all', // 'all' | 'T' | 'CT'
    weapon: 'all'
  };

  const listeners = new Set();

  function notify(reason) {
    bus.emit('filters:changed', { state: { ...state }, reason });
    for (const listener of [...listeners]) {
      try {
        listener({ ...state }, reason);
      } catch (error) {
        console.error('[MF filters] dinleyici hatası', error);
      }
    }
  }

  const filters = {
    get() { return { ...state }; },

    set(patch, reason = 'user') {
      let changed = false;
      for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in state)) continue;
        if (state[key] === value) continue;
        state[key] = value;
        changed = true;
      }
      if (changed) notify(reason);
      return changed;
    },

    /* Replay ekranındaki oyuncu seçimini izler (döngüye girmez). */
    setPlayerFromReplay(steamId) {
      const value = String(steamId || '');
      if (!value || value === state.playerSteamId) return false;
      state.playerSteamId = value;
      notify('replay');
      return true;
    },

    reset() {
      state.playerSteamId = '';
      state.round = 'all';
      state.side = 'all';
      state.weapon = 'all';
      notify('reset');
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  ns.filters = filters;

  // Demo değiştiğinde round filtresi geçersiz kalabilir.
  ns.bus.on('demo:changed', ({ model }) => {
    const numbers = model?.rounds?.map((round) => round.number) || [];
    if (state.round !== 'all' && !numbers.includes(Number(state.round))) {
      state.round = 'all';
      notify('demo');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
