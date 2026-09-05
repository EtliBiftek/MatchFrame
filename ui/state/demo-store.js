/*
 * MatchFrame — demo/analiz deposu.
 *
 * Demo yüklendiğinde analiz modeli BİR KEZ kurulur ve cache'lenir.
 * Ekranlar her render'da ham demo nesnesini taramaz.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const analysis = ns.analysis;
  const bus = ns.bus;

  const state = {
    status: 'empty', // empty | ready | error
    file: null,
    demo: null,
    model: null,
    error: null,
    buildMs: 0
  };

  let cacheKey = null;
  const listeners = new Set();

  function buildModel(demo) {
    const started = (root.performance?.now?.() ?? Date.now());
    let model;
    try {
      model = analysis.buildMatchModel(demo);
    } catch (error) {
      state.status = 'error';
      state.error = error?.message || String(error);
      state.model = null;
      console.error('[MF store] analiz modeli kurulamadı', error);
      bus.emit('demo:error', { error: state.error });
      return null;
    }
    const finished = (root.performance?.now?.() ?? Date.now());
    state.model = model;
    state.buildMs = Math.round(finished - started);
    return model;
  }

  const store = {
    getState() {
      return state;
    },
    get status() { return state.status; },
    getDemo() { return state.demo; },
    getModel() { return state.model; },
    isReady() { return state.status === 'ready' && Boolean(state.model); },

    setDemo(demo) {
      if (!demo) {
        store.clear();
        return null;
      }
      const key = `${demo.file || ''}|${demo.maxTick || 0}|${(demo.players || []).length}|${(demo.deaths || []).length}`;
      state.demo = demo;
      state.file = demo.file || null;
      state.error = null;
      state.status = 'ready';

      if (key !== cacheKey || !state.model) {
        cacheKey = key;
        buildModel(demo);
      }
      bus.emit('demo:changed', { demo, model: state.model });
      notify();
      return state.model;
    },

    /* Modeli yeniden kurar (konfigürasyon değiştiğinde veya test için). */
    rebuild() {
      if (!state.demo) return null;
      cacheKey = null;
      buildModel(state.demo);
      bus.emit('demo:changed', { demo: state.demo, model: state.model });
      notify();
      return state.model;
    },

    clear() {
      state.status = 'empty';
      state.demo = null;
      state.model = null;
      state.file = null;
      state.error = null;
      cacheKey = null;
      bus.emit('demo:cleared', null);
      notify();
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error('[MF store] dinleyici hatası', error);
      }
    }
  }

  ns.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
