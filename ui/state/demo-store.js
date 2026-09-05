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

  /* Rust karşılaştırma durumu (yalnızca köprü açıkken dolar). */
  let rustParity = null;

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
      if (state.model) runRustParity(demo, state.model);
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
      rustParity = null;
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
    },

    /* Rust modeliyle karşılaştırma sonucu (yalnızca köprü açıkken dolar). */
    getRustParity() { return rustParity; }
  };

  /*
   * Aşama 8 — Rust modeliyle gölge karşılaştırma.
   *
   * Varsayılan kapalı (localStorage 'mf.rustModel'). Açıkken JS modeli her
   * zamanki gibi kaynak doğrudur; Rust modeli yalnızca aynı sayıları üretiyor
   * mu diye karşılaştırılır. Sonuç `getRustParity()` ve 'analysis:rust' olayı
   * ile yayınlanır; UI bu yüzden asla Rust'a bağımlı değildir.
   */
  function compareWithRust(jsModel, rustModel) {
    const mismatches = [];
    let checked = 0;
    const push = (field, jsValue, rustValue) => {
      if (Math.abs(Number(jsValue || 0) - Number(rustValue || 0)) > 1) {
        mismatches.push({ field, js: jsValue, rust: rustValue });
      }
      checked += 1;
    };

    push('rounds.length', jsModel.rounds.length, (rustModel.rounds || []).length);
    (rustModel.rounds || []).forEach((round, index) => {
      const jsRound = jsModel.rounds[index];
      if (!jsRound) return;
      push(`round[${index}].kills`, (jsRound.kills || []).length, round.kills);
      const damage = (jsRound.damage || []).reduce((total, event) => total + (Number(event.damage) || 0), 0);
      push(`round[${index}].damage`, Math.round(damage), Math.round(round.damage || 0));
    });

    for (const player of rustModel.players || []) {
      const jsPlayer = jsModel.players?.[player.steamId];
      if (!jsPlayer) {
        mismatches.push({ field: `player.${player.steamId}`, js: null, rust: player.steamId });
        continue;
      }
      push(`${player.name}.kills`, jsPlayer.totals.kills, player.totals?.kills);
      push(`${player.name}.deaths`, jsPlayer.totals.deaths, player.totals?.deaths);
      push(`${player.name}.damage`, jsPlayer.totals.damage, player.totals?.damage);
    }

    return {
      ok: mismatches.length === 0,
      checked,
      mismatches: mismatches.slice(0, 20),
      engine: rustModel.engine || 'rust',
      deferred: rustModel.coverage?.deferred || []
    };
  }

  function runRustParity(demo, model) {
    const bridge = ns.analysis?.rustBridge;
    if (!bridge || typeof bridge.isEnabled !== 'function' || !bridge.isEnabled()) return;
    rustParity = { pending: true };
    Promise.resolve(bridge.buildModel(demo))
      .then((result) => {
        rustParity = result.ok
          ? compareWithRust(model, result.model)
          : { ok: false, checked: 0, mismatches: [], message: result.message };
        bus.emit('analysis:rust', rustParity);
      })
      .catch((error) => {
        rustParity = { ok: false, checked: 0, mismatches: [], message: String(error?.message || error) };
        bus.emit('analysis:rust', rustParity);
      });
  }

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
