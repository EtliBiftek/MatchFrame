/*
 * Rust analiz köprüsü (Aşama 8).
 *
 * Amaç: büyük demoda event taramasını renderer yerine native tarafta yapmak.
 *
 * Tasarım kuralları:
 *   - Varsayılan KAPALI. Rust tarafı `analysis-rs` cargo özelliği ile derlenir;
 *     özellik kapalıysa `analysis_build` action'ı açıklayıcı hata döner ve
 *     uygulama JS modelini kullanmaya devam eder.
 *   - Modelin tamamı taşınmadı: yalnızca event türevli toplamlar (kill/ölüm/
 *     hasar/ADR/headshot + round özetleri). Round kazananı çıkarımı, entry/trade,
 *     clutch, KAST ve ekonomi sınıflandırma hâlâ JS'te (bkz. coverage.deferred).
 *   - `frames` gönderilmez: IPC yükü küçük tutulur.
 *
 * Etkinleştirme (geliştirici):
 *   localStorage.setItem('mf.rustModel', '1')   → sonra demo yeniden yüklenir
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const ns = (root.MF = root.MF || {});
  ns.analysis = ns.analysis || {};
  ns.analysis.rustBridge = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'mf.rustModel';
  const ACTION = 'analysis_build';

  // IPC'ye gönderilecek alanlar (frames yok).
  const PAYLOAD_FIELDS = [
    'header', 'players', 'roundMeta', 'deaths', 'damage',
    'tickRate', 'durationSeconds', 'maxTick', 'file'
  ];

  const SUPPORTED = [
    'match.map', 'match.tickRate', 'match.roundsPlayed',
    'rounds[].kills', 'rounds[].deaths', 'rounds[].damage', 'rounds[].durationSeconds',
    'players[].totals.kills', 'players[].totals.deaths', 'players[].totals.damage',
    'players[].totals.adr', 'players[].totals.headshotKills',
    'teams[].totals.*'
  ];

  function storage() {
    try {
      return root.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function isEnabled() {
    const store = storage();
    if (!store) return false;
    try {
      return store.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setEnabled(enabled) {
    const store = storage();
    if (!store) return false;
    try {
      if (enabled) store.setItem(STORAGE_KEY, '1');
      else store.removeItem(STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function core() {
    try {
      const scope = root.window || root;
      return scope?.matchframe?.core || null;
    } catch (_) {
      return null;
    }
  }

  /* IPC'ye gidecek küçültülmüş demo (frames/bounds/cameraTracks gönderilmez). */
  function payloadFor(demo) {
    if (!demo || typeof demo !== 'object') return null;
    const payload = {};
    for (const field of PAYLOAD_FIELDS) {
      if (demo[field] !== undefined) payload[field] = demo[field];
    }
    return payload;
  }

  /*
   * Rust modelini ister. Hata/özellik kapalı durumunda throw etmez:
   * { ok: false, message } döner; çağıran JS modeline düşer.
   */
  async function buildModel(demo) {
    const bridge = core();
    const payload = payloadFor(demo);
    if (!bridge || typeof bridge.request !== 'function') {
      return { ok: false, model: null, message: 'Core köprüsü yok (Electron dışı ortam).' };
    }
    if (!payload) {
      return { ok: false, model: null, message: 'Demo nesnesi boş.' };
    }
    let response = null;
    try {
      response = await bridge.request(ACTION, payload);
    } catch (error) {
      return { ok: false, model: null, message: String(error?.message || error) };
    }
    if (!response || response.ok === false) {
      return { ok: false, model: null, message: response?.error || 'Rust analiz motoru yanıt vermedi.' };
    }
    const model = response.data;
    if (!model || typeof model !== 'object' || !Array.isArray(model.rounds)) {
      return { ok: false, model: null, message: 'Rust analiz motoru beklenen modeli döndürmedi.' };
    }
    return { ok: true, model, message: '' };
  }

  return {
    ACTION,
    STORAGE_KEY,
    SUPPORTED,
    isEnabled,
    setEnabled,
    payloadFor,
    buildModel
  };
}));
