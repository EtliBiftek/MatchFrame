/*
 * Utility ekranı (Aşama 5).
 *
 * Üç durum:
 *   1) demo yok                     → "Utility analizi için önce bir demo yükle"
 *   2) demo var, metrik yok         → "Bu demo bu metriği sağlamıyor" + sebep
 *   3) veri hazır                   → özet kartları, radar, oyuncu tablosu, olay listesi
 *
 * Kurallar:
 *   - Hesapların tamamı ui/analysis/utility-analysis.js içinde yapılır; bu dosya
 *     yalnızca render eder.
 *   - Eksik veri için tahmin üretilmez; ilgili kart/sütun/satır gizlenir.
 *   - Her olay satırından replay'e atlanabilir (MF.replay.jumpTo).
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const { el, clear, formatClock } = ns.dom;
  const components = ns.components;
  const analysis = ns.analysis;

  const KIND_LABELS = {
    all: 'Tümü',
    smoke: 'Smoke',
    flash: 'Flash',
    he: 'HE',
    molotov: 'Molotov',
    decoy: 'Decoy'
  };

  let container = null;
  let dirty = true;
  let kindFilter = 'all';
  let playerSort = { key: 'total', dir: 'desc' };
  let selectedTick = null;   // radar / listede vurgulanan event
  let timelineTick = null;   // seçili round içinde gösterilecek son tick
  let eventLimit = 40;
  let radarNode = null;
  let cachedModel = null;
  let cachedKey = '';
  let lastUtilityModel = null;

  function isActive() {
    return ns.navigation.current() === 'utility';
  }

  function requestRender() {
    dirty = true;
    if (isActive()) render();
  }

  function section(title, content, extra = null) {
    return el('section', { class: 'block' }, [
      el('header', { class: 'block-head' }, [
        el('h2', { class: 'block-title', text: title }),
        extra
      ]),
      el('div', { class: 'block-body' }, [content])
    ]);
  }

  function replayButton(tick, steamId) {
    return el('button', {
      type: 'button',
      class: 'btn secondary mini',
      text: 'Replay',
      title: `Tick ${Math.round(Number(tick) || 0)} · replay'e git`,
      onclick: (event) => {
        event.stopPropagation();
        ns.replay.jumpTo(tick, { steamId: steamId || undefined });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Model
   * ------------------------------------------------------------------ */

  function utilityModelFor(model) {
    const frames = ns.store.getDemo()?.frames;
    const key = `${model.match?.file || ''}|${model.rounds.length}|${model.playerOrder.length}|${(frames || []).length}`;
    if (cachedModel === model && cachedKey === key && lastUtilityModel) return lastUtilityModel;
    cachedModel = model;
    cachedKey = key;
    lastUtilityModel = analysis.buildUtilityModel(model, { frames });
    return lastUtilityModel;
  }

  function activeRound(model) {
    const { round } = ns.filters.get();
    if (round === 'all') return null;
    return model.rounds.find((entry) => Number(entry.number) === Number(round)) || null;
  }

  function sideOfPlayerInRound(model, round, steamId) {
    if (round) {
      if (round.roster?.T?.includes(steamId)) return 'T';
      if (round.roster?.CT?.includes(steamId)) return 'CT';
    }
    return model.players[steamId]?.side || '';
  }

  function filteredEvents(model) {
    const filter = ns.filters.get();
    const round = activeRound(model);
    const limit = round && timelineTick != null ? timelineTick : null;
    const events = (model.events.utility || [])
      .filter((event) => analysis.isUtilityThrowEvent(event))
      .filter((event) => kindFilter === 'all' || event.kind === kindFilter)
      .filter((event) => filter.playerSteamId ? String(event.actorSteamId) === String(filter.playerSteamId) : true)
      .filter((event) => event.round != null && round ? Number(event.round) === Number(round.number) : true)
      .filter((event) => limit == null || event.tick <= limit)
      .map((event) => ({
        ...event,
        side: sideOfPlayerInRound(model, round, String(event.actorSteamId))
      }));
    return events.sort((a, b) => a.tick - b.tick);
  }

  /* ------------------------------------------------------------------ *
   * Bölümler
   * ------------------------------------------------------------------ */

  function buildSummary(model, utility, events) {
    const totals = utility.totals;
    const blindsKnown = utility.availability.blinds !== 'unavailable';
    const damageKnown = utility.availability.damage !== 'unavailable';
    const filteredThrown = { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0, total: 0 };
    for (const event of events) {
      if (filteredThrown[event.kind] != null) {
        filteredThrown[event.kind] += 1;
        filteredThrown.total += 1;
      }
    }

    const cards = [
      components.statCard({ label: 'Atılan utility', value: filteredThrown.total, hint: 'seçili filtre' }),
      components.statCard({ label: 'Smoke', value: filteredThrown.smoke }),
      components.statCard({ label: 'Flash', value: filteredThrown.flash }),
      components.statCard({ label: 'HE', value: filteredThrown.he }),
      components.statCard({ label: 'Molotov', value: filteredThrown.molotov }),
      components.statCard({ label: 'Decoy', value: filteredThrown.decoy })
    ];

    if (blindsKnown) {
      cards.push(components.statCard({
        label: 'Kör edilen rakip',
        value: totals.flash.enemiesBlinded,
        hint: `toplam ${Math.round(totals.flash.enemiesBlindSeconds * 10) / 10} sn`
      }));
      cards.push(components.statCard({
        label: 'Kör edilen takım arkadaşı',
        value: totals.flash.teammatesBlinded,
        hint: `toplam ${Math.round(totals.flash.teammateBlindSeconds * 10) / 10} sn`
      }));
      cards.push(components.statCard({
        label: 'Boşa flash',
        value: totals.flash.wasted,
        hint: totals.flash.wastedRate != null ? `${Math.round(totals.flash.wastedRate)}% boşa` : 'oran yok'
      }));
    }

    if (damageKnown) {
      cards.push(components.statCard({
        label: 'Utility hasarı',
        value: Math.round(totals.he.damage + totals.molotov.damage),
        hint: `HE ${Math.round(totals.he.damage)} · Molotov ${Math.round(totals.molotov.damage)}`
      }));
    }

    if (utility.availability.smokes === 'full') {
      cards.push(components.statCard({
        label: 'Ort. smoke süresi',
        value: `${Math.round((totals.smoke.avgActiveSeconds || 0) * 10) / 10} sn`,
        hint: `${totals.smoke.expireSecondsKnown}/${totals.smoke.thrown} smoke ölçüldü`
      }));
    } else if (utility.availability.smokes === 'partial') {
      cards.push(components.statCard({
        label: 'Ort. smoke süresi',
        value: '—',
        hint: 'expire eventi yok, süre bilinmiyor'
      }));
    }

    return components.statGrid(cards);
  }

  function buildRadar(model, events, onSelect) {
    const points = events
      .filter((event) => event.position && Number.isFinite(event.position.x) && Number.isFinite(event.position.y))
      .map((event) => ({
        id: `${event.tick}:${event.actorSteamId}:${event.kind}`,
        kind: event.kind,
        x: event.position.x,
        y: event.position.y,
        tick: event.tick,
        team: event.side,
        label: `${event.actorName || '—'} · ${KIND_LABELS[event.kind] || event.kind}`,
        active: selectedTick != null && event.tick === selectedTick,
        event
      }));

    if (!radarNode) {
      radarNode = components.radar({ size: 320, onSelect });
    }
    radarNode.update(points);
    return el('div', { class: 'radar-wrap' }, [
      radarNode,
      el('div', { class: 'radar-caption', text: points.length ? 'Noktaya tıklayarak replay’e git' : 'Konum verisi yok' })
    ]);
  }

  function buildPlayerTable(model, utility) {
    const rows = utility.players.map((row) => ({
      steamId: row.steamId,
      name: row.name || row.steamId,
      team: row.teamName || '—',
      smoke: row.thrown.smoke,
      flash: row.thrown.flash,
      he: row.thrown.he,
      molotov: row.thrown.molotov,
      decoy: row.thrown.decoy,
      total: row.thrown.total,
      enemiesBlinded: row.flash.enemiesBlinded,
      teammatesBlinded: row.flash.teammatesBlinded,
      wastedFlash: row.flash.wasted,
      smokeSeconds: row.smoke.avgActiveSeconds,
      molotovDamage: row.molotov.damage,
      heDamage: row.he.damage,
      utilityDamage: row.damage.utilityDamage,
      keptAtRoundEnd: row.inventory.available ? row.inventory.keptAtRoundEnd.total : null,
      wastedOnDeath: row.inventory.available ? row.inventory.grenadesWastedOnDeath.total : null,
      confidence: row.confidence
    }));

    const columns = [
      { key: 'name', label: 'Oyuncu' },
      { key: 'team', label: 'Takım' },
      { key: 'smoke', label: 'Smoke', align: 'right' },
      { key: 'flash', label: 'Flash', align: 'right' },
      { key: 'he', label: 'HE', align: 'right' },
      { key: 'molotov', label: 'Molotov', align: 'right' },
      { key: 'decoy', label: 'Decoy', align: 'right' },
      { key: 'total', label: 'Toplam', align: 'right' }
    ];

    if (utility.availability.blinds !== 'unavailable') {
      columns.push(
        { key: 'enemiesBlinded', label: 'Rakip kör', align: 'right', title: 'Kör edilen rakip sayısı' },
        { key: 'teammatesBlinded', label: 'Takım kör', align: 'right', title: 'Kör edilen takım arkadaşı' },
        { key: 'wastedFlash', label: 'Boşa flash', align: 'right' }
      );
    }
    if (rows.some((row) => row.smokeSeconds != null)) {
      columns.push({ key: 'smokeSeconds', label: 'Smoke süre', align: 'right', value: (row) => (row.smokeSeconds == null ? '—' : `${Math.round(row.smokeSeconds * 10) / 10}s`) });
    }
    if (utility.availability.damage !== 'unavailable') {
      columns.push(
        { key: 'heDamage', label: 'HE hasar', align: 'right' },
        { key: 'molotovDamage', label: 'Molotov hasar', align: 'right' },
        { key: 'utilityDamage', label: 'Utility hasar', align: 'right' }
      );
    }
    if (rows.some((row) => row.keptAtRoundEnd != null)) {
      columns.push(
        { key: 'keptAtRoundEnd', label: 'Round başı elde', align: 'right', title: 'Round başında envanterde kalan nade' },
        { key: 'wastedOnDeath', label: 'Ölürken elde', align: 'right' }
      );
    }

    const sorted = [...rows].sort((a, b) => {
      const key = playerSort.key;
      const valueA = a[key];
      const valueB = b[key];
      let result;
      if (typeof valueA === 'string' || typeof valueB === 'string') {
        result = String(valueA ?? '').localeCompare(String(valueB ?? ''), 'tr');
      } else {
        result = Number(valueA || 0) - Number(valueB || 0);
      }
      return playerSort.dir === 'asc' ? result : -result;
    });

    const filter = ns.filters.get();
    return components.dataTable({
      columns,
      rows: sorted,
      sort: playerSort,
      onSort: (next) => {
        playerSort = next;
        requestRender();
      },
      emptyText: 'Bu demo için utility verisi yok',
      rowClass: (row) => (filter.playerSteamId && row.steamId === filter.playerSteamId ? 'is-selected' : ''),
      onRowClick: (row) => ns.filters.set({ playerSteamId: row.steamId === filter.playerSteamId ? '' : row.steamId }),
      caption: 'Sütunlar yalnızca ilgili veri varsa gösterilir'
    });
  }

  function buildEventList(model, utility, events) {
    const shown = events.slice(0, eventLimit);
    const filter = ns.filters.get();
    const tickRate = model.match?.tickRate || 64;

    const effectsByTick = new Map();
    if (utility.availability.blinds !== 'unavailable') {
      for (const blind of model.events.blinds || []) {
        const key = `${blind.tick}:${blind.actorSteamId}`;
        if (!effectsByTick.has(key)) effectsByTick.set(key, []);
        effectsByTick.get(key).push(`${blind.targetName || '?'}${blind.durationSeconds != null ? ` ${blind.durationSeconds}sn` : ''}`);
      }
    }

    const list = components.eventList({
      rows: shown,
      emptyText: kindFilter === 'all'
        ? 'Bu filtre için utility eventi yok'
        : `${KIND_LABELS[kindFilter]} eventi bulunamadı`,
      renderRow: (event) => {
        const firedNearby = effectsByTick.get(`${event.tick}:${event.actorSteamId}`) || [];
        let effect = 'etki yok';
        if (firedNearby.length) effect = `kör: ${firedNearby.join(', ')}`;
        else if (event.kind === 'he') effect = utility.availability.damage === 'unavailable' ? 'hasar verisi yok' : 'HE hasarı listede toplanır';
        else if (event.kind === 'molotov') effect = utility.availability.damage === 'unavailable' ? 'hasar verisi yok' : 'alan kontrolü';
        else if (event.kind === 'smoke') effect = utility.availability.smokes === 'unavailable' ? 'süre verisi yok' : 'görüş kesme';

        const badges = [
          { text: (KIND_LABELS[event.kind] || event.kind || '?').toUpperCase(), tone: event.kind === 'flash' ? 'warn' : 'neutral' },
          event.side ? { text: event.side, tone: event.side.toLowerCase() } : null,
          event.round != null ? { text: `R${event.round}`, tone: 'neutral' } : null,
          event.tick === selectedTick ? { text: 'seçili', tone: 'good' } : null
        ];

        return components.eventRow({
          title: `${event.actorName || '—'} → ${KIND_LABELS[event.kind] || event.kind}`,
          meta: [
            `tick ${Math.round(event.tick)}`,
            formatClock(event.tick / tickRate),
            event.position ? `x ${Math.round(event.position.x)} y ${Math.round(event.position.y)}` : null,
            effect
          ],
          badges,
          action: replayButton(event.tick, event.actorSteamId),
          tone: event.tick === selectedTick ? 'selected' : ''
        });
      },
      onRowClick: (event) => {
        selectedTick = selectedTick === event.tick ? null : event.tick;
        if (selectedTick != null) ns.replay.jumpTo(event.tick, { steamId: event.actorSteamId });
        requestRender();
      }
    });

    const block = el('div', { class: 'event-block' }, [list]);
    if (events.length > shown.length) {
      block.appendChild(el('button', {
        type: 'button',
        class: 'btn secondary mini more-button',
        text: `${events.length - shown.length} olay daha göster`,
        onclick: () => {
          eventLimit += 60;
          requestRender();
        }
      }));
    }
    return block;
  }

  function buildNotes(model, utility) {
    const notes = [];
    if (!model.availability.blinds?.available) {
      notes.push(`player_blind: ${model.availability.blinds?.error || 'yok'} — körlük metrikleri gizlendi`);
    }
    if (!model.availability.damage?.available) {
      notes.push(`player_hurt: ${model.availability.damage?.error || 'yok'} — hasar metrikleri gizlendi`);
    }
    if (model.availability.utility?.available && utility.availability.smokes === 'partial') {
      notes.push('smokegrenade_expired yok: smoke süreleri ölçülemedi (tahmin üretilmedi)');
    }
    if (utility.availability.frames === 'unavailable') {
      notes.push('tick state yok: envanter (elde kalan utility) metrikleri hesaplanamadı');
    }
    for (const warning of utility.warnings || []) notes.push(warning);
    if (!notes.length) return null;
    return el('div', { class: 'data-notes' }, [
      el('span', { class: 'data-notes-title', text: 'Veri durumu' }),
      ...notes.map((note) => el('span', { class: 'data-note', text: note }))
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  function render() {
    if (!container) return;
    clear(container);
    const state = ns.store.getState();

    if (state.status !== 'ready' || !ns.store.isReady()) {
      container.appendChild(components.noDemo(
        'Grenade kullanımı, smoke süreleri ve flash etkisi için önce bir demo yükle.',
        () => root.MatchFrameBridge?.openDemo?.()
      ));
      dirty = false;
      return;
    }

    const model = ns.store.getModel();
    if (!model?.ready) {
      container.appendChild(components.emptyState({
        kind: 'error',
        title: 'Analiz modeli kurulamadı',
        message: state.error || model?.reason || 'Bilinmeyen hata'
      }));
      dirty = false;
      return;
    }

    if (!model.availability.utility?.available) {
      container.appendChild(components.noDataset(
        'Bu demo utility metriklerini sağlamıyor.',
        [model.availability.utility?.error || 'smokegrenade_detonate / flashbang_detonate parse edilemedi']
      ));
      dirty = false;
      return;
    }

    const utility = utilityModelFor(model);
    if (!utility.available) {
      container.appendChild(components.noDataset(
        'Bu demo utility metriklerini sağlamıyor.',
        utility.warnings.length ? utility.warnings : ['Utility eventleri bulunamadı']
      ));
      dirty = false;
      return;
    }

    const round = activeRound(model);
    const events = filteredEvents(model);
    const filter = ns.filters.get();

    // Round değiştiyse timeline sıfırlanır.
    if (round) {
      if (timelineTick == null || timelineTick < round.startTick || timelineTick > round.endTick) {
        timelineTick = round.endTick;
      }
    } else {
      timelineTick = null;
    }

    const kindField = components.selectField({
      label: 'Tür',
      options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
      value: kindFilter,
      onChange: (value) => {
        kindFilter = value;
        eventLimit = 40;
        requestRender();
      }
    });

    const timeline = round
      ? el('label', { class: 'filter-field radar-timeline' }, [
        el('span', { class: 'filter-label', text: 'Zaman' }),
        el('input', {
          type: 'range',
          class: 'filter-range',
          min: String(round.jumpTick ?? round.startTick),
          max: String(round.endTick),
          value: String(timelineTick ?? round.endTick),
          'aria-label': 'Round içi zaman',
          oninput: (event) => {
            timelineTick = Number(event.target.value);
            renderRadarOnly(model, utility);
          }
        }),
        el('span', {
          class: 'toolbar-note radar-time',
          text: formatClock((Number(timelineTick ?? round.endTick) - (round.jumpTick ?? round.startTick)) / (model.match.tickRate || 64))
        })
      ])
      : null;

    const toolbar = components.toolbar([
      components.roundFilter(model),
      components.playerFilter(model),
      components.sideFilter(),
      kindField,
      timeline,
      el('div', { class: 'toolbar-spacer' }),
      el('span', {
        class: 'toolbar-note',
        text: `${model.match.map || 'map yok'} · ${model.rounds.length} round · ${events.length} utility`
      }),
      filter.playerSteamId
        ? el('button', {
          type: 'button',
          class: 'btn secondary mini',
          text: 'Seçimi temizle',
          onclick: () => ns.filters.set({ playerSteamId: '' })
        })
        : null
    ]);

    const body = el('div', { class: 'view-body' }, [
      section('Özet', buildSummary(model, utility, events)),
      section(round ? `Radar · Round ${round.number}` : 'Radar · tüm maç', buildRadar(model, events, (point) => {
        selectedTick = point.tick;
        ns.replay.jumpTo(point.tick, { steamId: point.event?.actorSteamId });
        requestRender();
      })),
      section('Oyuncu bazında utility', buildPlayerTable(model, utility)),
      section('Utility olayları', buildEventList(model, utility, events))
    ]);

    ns.analysis.coaching.ensure(model, { playerSteamId: filter.playerSteamId || '' });
    body.appendChild(components.coachSection({
      title: 'Koçluk notları · utility',
      categories: ['utility'],
      note: 'Yalnızca utility kategorisindeki notlar gösterilir; diğerleri Analysis ekranında.'
    }));

    const notes = buildNotes(model, utility);
    if (notes) body.appendChild(notes);

    container.append(toolbar, body);
    dirty = false;
  }

  /* Zaman çizelgesi kaydırıldığında yalnızca radar + özet + liste yenilenir. */
  function renderRadarOnly(model, utility) {
    const events = filteredEvents(model);
    const round = activeRound(model);
    const radarSection = container?.querySelector('.radar-wrap');
    const label = container?.querySelector('.radar-caption');
    if (radarSection && radarNode) {
      radarNode.update(events
        .filter((event) => event.position && Number.isFinite(event.position.x) && Number.isFinite(event.position.y))
        .map((event) => ({
          id: `${event.tick}:${event.actorSteamId}:${event.kind}`,
          kind: event.kind,
          x: event.position.x,
          y: event.position.y,
          tick: event.tick,
          team: event.side,
          active: selectedTick != null && event.tick === selectedTick,
          event
        })));
      if (label) label.textContent = events.length ? 'Noktaya tıklayarak replay’e git' : 'Konum verisi yok';
    }
    const note = container?.querySelector('.radar-time');
    if (note && round) {
      note.textContent = formatClock((Number(timelineTick ?? round.endTick) - (round.jumpTick ?? round.startTick)) / (model.match.tickRate || 64));
    }
    void utility;
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
    invalidate: requestRender
  });

  ns.bus.on('demo:changed', () => {
    cachedModel = null;
    lastUtilityModel = null;
    selectedTick = null;
    timelineTick = null;
    requestRender();
  });
  ns.bus.on('demo:cleared', () => {
    cachedModel = null;
    lastUtilityModel = null;
    selectedTick = null;
    timelineTick = null;
    requestRender();
  });
  ns.filters.subscribe(() => {
    eventLimit = 40;
    requestRender();
  });

  ns.utilityView = { requestRender, isActive, get kindFilter() { return kindFilter; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
