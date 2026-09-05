/*
 * Ruby koçluk köprüsü (Aşama 7.2) — hesap + iletişim katmanı.
 *
 * Akış:
 *   JS  : buildCoachingSummary(model) → normalize metrikler
 *   IPC : window.matchframe.core.request('ruby_analyze', { metrics, availability, scope })
 *   Rust: run_ruby(payload) → backend/analytics/analyze.rb
 *   Ruby: kurallar → { engine, notes: [{ severity, category, tag, text, metric }] }
 *   JS  : notlar Aim / Utility / Analysis ekranlarında gösterilir
 *
 * Kurallar:
 *   - Ruby yoksa, hata verirse veya geçersiz JSON dönerse ekran ÇALIŞMAYA DEVAM EDER;
 *     yalnızca durum notu gösterilir (status: 'unavailable' | 'error').
 *   - Tahmin üretilmez: verisi olmayan metrik gönderilmez, availability false işaretlenir
 *     ve Ruby tarafındaki ilgili kural atlanır.
 *   - Koçluk motoru karar vermez; yalnızca ölçülen metrikleri yorumlar.
 */
(function (root, factory) {
  'use strict';
  const analysis = (typeof module === 'object' && module.exports)
    ? Object.assign({},
      require('./common.js'),
      require('./match-analysis.js'),
      require('./aim-analysis.js'),
      require('./utility-analysis.js'),
      require('./advanced-analysis.js'))
    : root.MF.analysis;
  const api = factory(analysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  const ns = (root.MF = root.MF || {});
  // Koçluk API'si kendi ad alanında durur: SCHEMA_VERSION gibi alanlar diğer
  // analiz modüllerinin alanlarını ezmesin.
  ns.analysis = ns.analysis || {};
  ns.analysis.coaching = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (analysis) {
  'use strict';

  /*
   * UMD deseninde factory, dış IIFE'nin argümanı olarak tanımlanır; bu yüzden
   * `root` değişkeni factory içinde görünmez. Global kapsayıcıyı burada alıyoruz.
   */
  const globalScope = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof window !== 'undefined' ? window : {});

  const SCHEMA_VERSION = 2;

  const CATEGORIES = ['aim', 'utility', 'entry', 'economy', 'positioning'];
  const CATEGORY_LABELS = {
    aim: 'Aim',
    utility: 'Utility',
    entry: 'Entry / trade',
    economy: 'Ekonomi',
    positioning: 'Pozisyon'
  };
  const SEVERITIES = ['high', 'medium', 'low'];
  const SEVERITY_LABELS = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' };

  /* Eski (v1) etiketlerini kategoriye çevirir; bilinmeyen etiket 'aim' değil null döner. */
  const LEGACY_TAGS = { aim: 'aim', utility: 'utility', entry: 'entry', economy: 'economy' };

  function num(value) {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits = 2) {
    const parsed = num(value);
    return parsed === null ? null : Number(parsed.toFixed(digits));
  }

  function sum(values) {
    let total = 0;
    for (const value of values) total += Number(value) || 0;
    return total;
  }

  function average(values) {
    const usable = values.map(num).filter((value) => value !== null);
    if (!usable.length) return null;
    return usable.reduce((total, value) => total + value, 0) / usable.length;
  }

  function ratio(top, bottom) {
    const a = num(top);
    const b = num(bottom);
    if (a === null || b === null || b <= 0) return null;
    return a / b;
  }

  /* Alt modeller (aim/utility/economy/opening) model başına bir kez kurulur. */
  const subModelCache = new WeakMap();

  function subModels(model) {
    if (!model) return null;
    if (subModelCache.has(model)) return subModelCache.get(model);
    let built = null;
    try {
      built = {
        aim: analysis.buildAimModel ? analysis.buildAimModel(model) : null,
        utility: analysis.buildUtilityModel ? analysis.buildUtilityModel(model) : null,
        economy: analysis.buildEconomyModel ? analysis.buildEconomyModel(model) : null,
        opening: analysis.buildOpeningDuels ? analysis.buildOpeningDuels(model) : null
      };
    } catch (error) {
      built = { error: error?.message || String(error) };
    }
    subModelCache.set(model, built);
    return built;
  }

  function playerEntries(model) {
    if (!model?.players) return [];
    return Object.values(model.players).filter((player) => player && player.steamId);
  }

  /* Oyuncu bazlı özet: seçili oyuncu varsa onun, yoksa maç geneli toplamlar. */
  function collectFromPlayers(model, steamId) {
    const entries = playerEntries(model);
    const focused = steamId ? entries.filter((player) => player.steamId === steamId) : entries;
    const pool = focused.length ? focused : entries;
    const totals = pool.map((player) => player.totals || {});
    const headshotRate = ratio(sum(totals.map((entry) => entry.headshotKills)), sum(totals.map((entry) => entry.kills)));
    return {
      scope: focused.length === 1 ? 'player' : 'match',
      playerCount: pool.length,
      kills: sum(totals.map((entry) => entry.kills)),
      deaths: sum(totals.map((entry) => entry.deaths)),
      adr: average(totals.map((entry) => entry.adr)),
      kast: average(totals.map((entry) => entry.kastPercent)),
      headshotPercent: headshotRate === null ? null : headshotRate * 100,
      flashAssists: sum(totals.map((entry) => entry.flashAssists)),
      utilityThrown: sum(totals.map((entry) => sum(Object.values(entry.utility || {}))))
    };
  }

  /*
   * Entry (round içindeki ilk ölüm) istatistikleri player totals'tan değil
   * normalize kill eventlerinden hesaplanır: totals.tradedDeaths tüm trade
   * edilen ölümleri sayar, entry ölümlerini değil.
   */
  function entryStats(model, steamId) {
    const kills = model?.events?.kills || [];
    if (!kills.length) return { entryKills: null, entryDeaths: null, entryTraded: null };
    const entries = kills.filter((event) => event && event.isEntry && !event.teamKill && !event.suicide);
    if (!entries.length) return { entryKills: null, entryDeaths: null, entryTraded: null };
    const deaths = steamId ? entries.filter((event) => event.targetSteamId === steamId) : entries;
    const scored = steamId ? entries.filter((event) => event.actorSteamId === steamId) : entries;
    return {
      entryKills: scored.length,
      entryDeaths: deaths.length,
      entryTraded: deaths.filter((event) => Boolean(event.traded)).length
    };
  }

  function aimMetrics(aim, steamId) {
    if (!aim || !aim.available) return {};
    if (steamId && aim.players && aim.players[steamId]) {
      const player = aim.players[steamId];
      return {
        avgCrosshairErrorDeg: round(player.crosshairErrorDeg),
        potentialReactionMs: player.potentialReactionMs === null || player.potentialReactionMs === undefined
          ? null : Math.round(player.potentialReactionMs),
        movingShotRate: round(player.movingShotRate, 3),
        avgKillDistance: round(player.avgKillDistance, 1),
        headshotPercent: round(player.headshotPercent, 1),
        confidence: player.confidence || null
      };
    }
    const totals = aim.totals || {};
    return {
      avgCrosshairErrorDeg: round(totals.crosshairErrorDeg),
      potentialReactionMs: totals.potentialReactionMs === null || totals.potentialReactionMs === undefined
        ? null : Math.round(totals.potentialReactionMs),
      movingShotRate: round(totals.movingShotRate, 3),
      avgKillDistance: round(totals.avgKillDistance, 1),
      headshotPercent: round(totals.headshotPercent, 1),
      confidence: null
    };
  }

  function utilityMetrics(utility, steamId, fallbackThrown) {
    if (!utility || !utility.available) return {};
    const source = (steamId && utility.players && utility.players[steamId]) ? utility.players[steamId] : utility.totals;
    if (!source) return {};
    const thrown = source.thrown || {};
    const flash = source.flash || {};
    return {
      flashAssists: flash.assists === null || flash.assists === undefined ? null : Number(flash.assists),
      enemiesBlinded: flash.enemiesBlinded === null || flash.enemiesBlinded === undefined ? null : Number(flash.enemiesBlinded),
      teammatesBlinded: flash.teammatesBlinded === null || flash.teammatesBlinded === undefined ? null : Number(flash.teammatesBlinded),
      utilityThrown: sum(Object.values(thrown)) || fallbackThrown || null
    };
  }

  function economyMetrics(economy) {
    if (!economy || !economy.available) return {};
    const rounds = economy.rounds || [];
    let forceRounds = 0;
    let forceWins = 0;
    for (const roundEntry of rounds) {
      for (const side of ['T', 'CT']) {
        const sideData = roundEntry.bySide?.[side];
        if (!sideData) continue;
        if (sideData.buy === 'force') {
          forceRounds += 1;
          if (sideData.won) forceWins += 1;
        }
      }
    }
    const totals = economy.totals || {};
    return {
      ecoRounds: Number(totals.eco) || 0,
      forceRounds,
      fullRounds: Number(totals.full) || 0,
      spendPerRound: economy.roundCount
        ? Math.round((Number(totals.spend) || 0) / economy.roundCount) : null,
      forceWinRate: forceRounds ? round(forceWins / forceRounds, 3) : null
    };
  }

  function openingMetrics(opening, steamId) {
    if (!opening || !opening.available) return {};
    const duels = opening.duels || [];
    const pool = steamId ? duels.filter((duel) => duel.attackerSteamId === steamId) : duels;
    if (!pool.length) return {};
    const won = pool.filter((duel) => Boolean(duel.roundWonByAttackerSide)).length;
    return {
      openingAttempts: pool.length,
      openingSuccessPercent: round((won / pool.length) * 100, 1)
    };
  }

  /*
   * Ruby motoruna gönderilecek normalize metrik özeti.
   * Her metrik ya sayı ya null'dur; null olanlar gönderilmez.
   */
  function buildCoachingSummary(model, options = {}) {
    const steamId = options.playerSteamId || '';
    const subs = subModels(model) || {};
    const base = collectFromPlayers(model, steamId);
    const entry = entryStats(model, steamId);
    const rounds = model?.rounds?.length || 0;

    const metrics = {
      rounds,
      tick_rate: num(model?.match?.tickRate),
      kills: base.kills,
      deaths: base.deaths,
      adr: round(base.adr, 1),
      kast_percent: round(base.kast, 1),
      headshot_percent: round(base.headshotPercent, 1),
      entry_kills: entry.entryKills,
      entry_deaths: entry.entryDeaths,
      entry_traded: entry.entryTraded,
      entry_trade_rate: round(ratio(entry.entryTraded, entry.entryDeaths), 3)
    };

    Object.assign(metrics, aimMetrics(subs.aim, steamId));
    Object.assign(metrics, utilityMetrics(subs.utility, steamId, base.utilityThrown));
    Object.assign(metrics, economyMetrics(subs.economy));
    Object.assign(metrics, openingMetrics(subs.opening, steamId));

    // Ruby'ye giden sözlük: anahtarlar snake_case, değerler sayı.
    const outgoing = {
      rounds: metrics.rounds,
      tick_rate: metrics.tick_rate,
      kills: metrics.kills,
      deaths: metrics.deaths,
      adr: metrics.adr,
      kast_percent: metrics.kast_percent,
      headshot_percent: metrics.headshot_percent,
      entry_kills: metrics.entry_kills,
      entry_deaths: metrics.entry_deaths,
      entry_traded: metrics.entry_traded,
      entry_trade_rate: metrics.entry_trade_rate,
      avg_crosshair_error_deg: metrics.avgCrosshairErrorDeg ?? null,
      potential_reaction_ms: metrics.potentialReactionMs ?? null,
      moving_shot_rate: metrics.movingShotRate ?? null,
      avg_kill_distance: metrics.avgKillDistance ?? null,
      flash_assists: metrics.flashAssists ?? null,
      enemies_blinded: metrics.enemiesBlinded ?? null,
      teammates_blinded: metrics.teammatesBlinded ?? null,
      utility_thrown: metrics.utilityThrown ?? null,
      eco_rounds: metrics.ecoRounds ?? null,
      force_rounds: metrics.forceRounds ?? null,
      full_rounds: metrics.fullRounds ?? null,
      spend_per_round: metrics.spendPerRound ?? null,
      force_win_rate: metrics.forceWinRate ?? null,
      opening_attempts: metrics.openingAttempts ?? null,
      opening_success_percent: metrics.openingSuccessPercent ?? null
    };

    // null olanlar gönderilmez → Ruby kuralı atlar (tahmin yok).
    const metrics_out = {};
    for (const [key, value] of Object.entries(outgoing)) {
      if (value === null || value === undefined || Number.isNaN(value)) continue;
      metrics_out[key] = value;
    }

    const availability = {
      entry: metrics_out.entry_deaths !== undefined && metrics_out.entry_traded !== undefined,
      aim: ['avg_crosshair_error_deg', 'potential_reaction_ms', 'avg_kill_distance', 'headshot_percent']
        .some((key) => metrics_out[key] !== undefined),
      utility: ['flash_assists', 'enemies_blinded', 'utility_thrown']
        .some((key) => metrics_out[key] !== undefined),
      economy: metrics_out.force_rounds !== undefined || metrics_out.eco_rounds !== undefined,
      opening: metrics_out.opening_attempts !== undefined
    };

    const missing = [];
    for (const key of Object.keys(outgoing)) {
      if (metrics_out[key] === undefined) missing.push(key);
    }

    const focusPlayer = steamId ? playerEntries(model).find((player) => player.steamId === steamId) : null;

    return {
      schemaVersion: SCHEMA_VERSION,
      scope: focusPlayer ? 'player' : 'match',
      player: focusPlayer
        ? { steamId: focusPlayer.steamId, name: focusPlayer.name, teamName: focusPlayer.teamName || null }
        : null,
      match: {
        map: model?.match?.map || null,
        tickRate: num(model?.match?.tickRate),
        rounds,
        durationSeconds: num(model?.match?.durationSeconds)
      },
      metrics: metrics_out,
      availability,
      missing,
      subModelError: subs.error || null
    };
  }

  /* Ruby çıktısını doğrular: beklenmeyen alanları temizler, bilinmeyen notu atar. */
  function normalizeNotes(payload) {
    const raw = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.notes) ? payload.notes : null);
    if (!raw) return [];
    const notes = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text) continue;
      const severity = SEVERITIES.includes(entry.severity) ? entry.severity : 'low';
      let category = CATEGORIES.includes(entry.category) ? entry.category : null;
      if (!category && LEGACY_TAGS[entry.tag]) category = LEGACY_TAGS[entry.tag];
      if (!category) continue; // kategorisi bilinmeyen not gösterilmez
      notes.push({
        severity,
        category,
        tag: typeof entry.tag === 'string' && entry.tag.trim() ? entry.tag.trim() : category,
        text,
        metric: typeof entry.metric === 'string' ? entry.metric : null
      });
    }
    // Motor sıralamasına güvenmeden önem sırasına diz (high → medium → low).
    const severityRank = { high: 0, medium: 1, low: 2 };
    notes.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity])
      || a.category.localeCompare(b.category));
    return notes;
  }

  function coreBridge() {
    try {
      const scope = globalScope.window || globalScope;
      return scope?.matchframe?.core || null;
    } catch (_) {
      return null;
    }
  }

  /*
   * IPC çağrısı. Hata durumunda throw etmez; durum nesnesi döner.
   * status: 'ok' | 'unavailable' | 'error'
   */
  async function requestCoaching(summary) {
    const core = coreBridge();
    if (!core || typeof core.request !== 'function') {
      return { status: 'unavailable', notes: [], engine: null, message: 'Core köprüsü yok (Electron dışı ortam).' };
    }
    let response = null;
    try {
      response = await core.request('ruby_analyze', {
        metrics: summary?.metrics || {},
        availability: summary?.availability || {},
        scope: summary?.scope || 'match'
      });
    } catch (error) {
      return { status: 'unavailable', notes: [], engine: null, message: String(error?.message || error) };
    }
    if (!response || response.ok === false) {
      return {
        status: 'unavailable',
        notes: [],
        engine: null,
        message: response?.error || 'Ruby koçluk motoru yanıt vermedi.'
      };
    }
    const data = response.data && typeof response.data === 'object' ? response.data : null;
    if (!data || !Array.isArray(data.notes)) {
      return {
        status: 'unavailable',
        notes: [],
        engine: data?.engine || null,
        message: 'Ruby koçluk motoru bu ortamda etkin değil (not listesi boş döndü).'
      };
    }
    const notes = normalizeNotes(data.notes);
    return {
      status: 'ok',
      notes,
      engine: typeof data.engine === 'string' ? data.engine : 'ruby',
      evaluated: Number.isFinite(Number(data.evaluated)) ? Number(data.evaluated) : null,
      skipped: Array.isArray(data.skipped) ? data.skipped.slice(0, 32) : [],
      message: notes.length ? '' : 'Bu maç için kural tetiklenmedi (metrikler hedeflerin içinde).'
    };
  }

  /* --- oturum durumu (ekranlar arası ortak, model başına tek istek) ---------- */

  const state = {
    status: 'idle', // idle | loading | ok | unavailable | error
    notes: [],
    engine: null,
    message: '',
    evaluated: null,
    skipped: [],
    summary: null
  };
  const listeners = new Set();
  let sessionKey = '';
  let lastRequest = null;

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        if (globalScope.console) globalScope.console.error('[MF coaching] dinleyici hatası', error);
      }
    }
  }

  function setState(patch) {
    Object.assign(state, patch);
    notify();
  }

  function keyFor(model, steamId) {
    return [
      model?.match?.file || '',
      model?.rounds?.length || 0,
      model?.match?.maxTick || 0,
      steamId || 'all'
    ].join('|');
  }

  function ensure(model, options = {}) {
    if (!model) return state;
    const steamId = options.playerSteamId || '';
    const key = keyFor(model, steamId);
    if (key === sessionKey && state.status !== 'idle') return state;
    sessionKey = key;
    lastRequest = { model, steamId };
    const summary = buildCoachingSummary(model, { playerSteamId: steamId });
    setState({ status: 'loading', notes: [], engine: null, message: '', evaluated: null, skipped: [], summary });
    Promise.resolve(requestCoaching(summary))
      .then((result) => {
        // Model değiştiyse eski yanıt yoksayılır.
        if (key !== sessionKey) return;
        setState({
          status: result.status,
          notes: result.notes || [],
          engine: result.engine || null,
          message: result.message || '',
          evaluated: result.evaluated ?? null,
          skipped: result.skipped || []
        });
      })
      .catch((error) => {
        if (key !== sessionKey) return;
        setState({ status: 'error', notes: [], engine: null, message: String(error?.message || error) });
      });
    return state;
  }

  function refresh() {
    if (!lastRequest) return state;
    sessionKey = '';
    return ensure(lastRequest.model, { playerSteamId: lastRequest.steamId });
  }

  function reset() {
    sessionKey = '';
    lastRequest = null;
    setState({
      status: 'idle', notes: [], engine: null, message: '',
      evaluated: null, skipped: [], summary: null
    });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    SCHEMA_VERSION,
    CATEGORIES,
    CATEGORY_LABELS,
    SEVERITIES,
    SEVERITY_LABELS,
    buildCoachingSummary,
    requestCoaching,
    normalizeNotes,
    ensure,
    refresh,
    reset,
    subscribe,
    getState: () => state
  };
}));
