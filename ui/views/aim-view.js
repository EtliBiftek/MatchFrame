/*
 * Aim ekranı (Aşama 6).
 *
 * Üç durum:
 *   1) demo yok                     → "Aim analizi için önce bir demo yükle"
 *   2) demo var, metrik yok         → "Bu demo bu metriği sağlamıyor" + sebep
 *   3) veri hazır                   → kartlar, ısı haritası, silah tablosu, düello listesi
 *
 * Doğruluk sınırları ekranda açıkça gösterilir:
 *   - Visibility (raycast) doğrulaması yok → "potential reaction time" etiketi.
 *   - bullet_impact yoksa accuracy/isabet hesaplanmaz, sütun gizlenir.
 *   - Tick state yoksa crosshair hatası, hareket ve reaction hesaplanmaz.
 *   - Tahmin üretilmez: veri yoksa değer "—" ve sebep notlarda yazılır.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});
  const { el, clear, formatClock, formatNumber } = ns.dom;
  const components = ns.components;
  const analysis = ns.analysis;

  let container = null;
  let dirty = true;
  let playerSort = { key: 'kills', dir: 'desc' };
  let weaponSort = { key: 'kills', dir: 'desc' };
  let selectedDuelId = null;
  let radarNode = null;
  let cachedModel = null;
  let cachedKey = '';
  let lastAimModel = null;

  function isActive() {
    return ns.navigation.current() === 'aim';
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

  function fmt(value, digits = 0, fallback = '—') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return fallback;
    return formatNumber(Number(value), digits);
  }

  /* ------------------------------------------------------------------ *
   * Model + filtreler
   * ------------------------------------------------------------------ */

  function aimModelFor(model) {
    const frames = ns.store.getDemo()?.frames;
    const key = `${model.match?.file || ''}|${model.rounds.length}|${model.playerOrder.length}|${(frames || []).length}`;
    if (cachedModel === model && cachedKey === key && lastAimModel) return lastAimModel;
    cachedModel = model;
    cachedKey = key;
    lastAimModel = analysis.buildAimModel(model, { frames });
    return lastAimModel;
  }

  function activeRound(model) {
    const { round } = ns.filters.get();
    if (round === 'all') return null;
    return model.rounds.find((entry) => Number(entry.number) === Number(round)) || null;
  }

  function filteredDuels(model, aim) {
    const filter = ns.filters.get();
    const round = activeRound(model);
    return aim.duels.filter((duel) => {
      if (round && Number(duel.round) !== Number(round.number)) return false;
      if (filter.playerSteamId
        && String(duel.attackerSteamId) !== String(filter.playerSteamId)
        && String(duel.victimSteamId) !== String(filter.playerSteamId)) return false;
      if (filter.weapon && filter.weapon !== 'all' && duel.weapon !== filter.weapon) return false;
      return true;
    });
  }

  function weaponRows(model, aim) {
    const filter = ns.filters.get();
    const round = activeRound(model);
    const map = new Map();
    for (const player of aim.players) {
      if (filter.playerSteamId && String(player.steamId) !== String(filter.playerSteamId)) continue;
      for (const weapon of player.weapons || []) {
        if (filter.weapon && filter.weapon !== 'all' && weapon.key !== filter.weapon) continue;
        if (!map.has(weapon.key)) {
          map.set(weapon.key, {
            key: weapon.key,
            label: weapon.label,
            kills: 0, headshots: 0, shots: 0, hits: 0, damage: 0, blindKills: 0
          });
        }
        const row = map.get(weapon.key);
        row.kills += weapon.kills;
        row.headshots += weapon.headshots;
        row.shots += weapon.shots;
        row.hits += weapon.hits;
        row.damage += weapon.damage;
        row.blindKills += weapon.blindKills;
      }
    }
    void round;
    return [...map.values()].map((row) => ({
      ...row,
      headshotPercent: row.kills > 0 ? Math.round((row.headshots / row.kills) * 100) : 0,
      accuracy: aim.availability.impacts !== 'unavailable' && row.shots > 0
        ? Math.round((row.hits / row.shots) * 1000) / 10
        : null
    }));
  }

  function sortedRows(rows, sort) {
    return [...rows].sort((a, b) => {
      const valueA = a[sort.key];
      const valueB = b[sort.key];
      let result;
      if (typeof valueA === 'string' || typeof valueB === 'string') {
        result = String(valueA ?? '').localeCompare(String(valueB ?? ''), 'tr');
      } else {
        result = Number(valueA || 0) - Number(valueB || 0);
      }
      return sort.dir === 'asc' ? result : -result;
    });
  }

  /* ------------------------------------------------------------------ *
   * Bölümler
   * ------------------------------------------------------------------ */

  function summarize(aim, duels) {
    const totals = {
      kills: 0, headshots: 0, shots: 0, impacts: 0, damage: 0,
      crosshairSum: 0, crosshairCount: 0, reactionSum: 0, reactionCount: 0,
      distanceSum: 0, distanceCount: 0
    };
    const source = aim.players;
    for (const player of source) {
      totals.kills += player.kills;
      totals.headshots += player.headshots;
      totals.shots += player.shots;
      totals.impacts += player.impacts;
      totals.damage += player.damage;
      if (player.crosshairErrorDeg != null) {
        totals.crosshairSum += player.crosshairErrorDeg * player.crosshairSamples;
        totals.crosshairCount += player.crosshairSamples;
      }
      if (player.potentialReactionMs != null) {
        totals.reactionSum += player.potentialReactionMs * player.reactionSamples;
        totals.reactionCount += player.reactionSamples;
      }
      if (player.avgKillDistance != null && player.distanceSamples) {
        totals.distanceSum += player.avgKillDistance * player.distanceSamples;
        totals.distanceCount += player.distanceSamples;
      }
    }
    void duels;
    return {
      kills: totals.kills,
      headshotPercent: totals.kills > 0 ? (totals.headshots / totals.kills) * 100 : null,
      headshots: totals.headshots,
      accuracy: aim.availability.impacts !== 'unavailable' && totals.shots > 0 ? (totals.impacts / totals.shots) * 100 : null,
      shots: totals.shots,
      damage: totals.damage,
      avgKillDistance: totals.distanceCount > 0 ? totals.distanceSum / totals.distanceCount : null,
      crosshairErrorDeg: totals.crosshairCount > 0 ? totals.crosshairSum / totals.crosshairCount : null,
      potentialReactionMs: totals.reactionCount > 0 ? totals.reactionSum / totals.reactionCount : null,
      movingShotRate: aim.totals.movingShotRate
    };
  }

  function crosshairTone(degrees, thresholds) {
    if (degrees == null) return '';
    if (degrees <= thresholds.crosshair.great) return 'good';
    if (degrees <= thresholds.crosshair.ok) return '';
    if (degrees <= thresholds.crosshair.weak) return 'warn';
    return 'bad';
  }

  function crosshairLabel(degrees, thresholds) {
    if (degrees == null) return '';
    if (degrees <= thresholds.crosshair.great) return `≤${thresholds.crosshair.great}° çok iyi`;
    if (degrees <= thresholds.crosshair.ok) return `${thresholds.crosshair.great}-${thresholds.crosshair.ok}° kabul edilebilir`;
    if (degrees <= thresholds.crosshair.weak) return `${thresholds.crosshair.ok}-${thresholds.crosshair.weak}° zayıf`;
    return `${thresholds.crosshair.weak}°+ ciddi sapma`;
  }

  function buildSummary(aim, duels) {
    const totals = summarize(aim, duels);
    const impactKnown = aim.availability.impacts !== 'unavailable';
    const framesKnown = aim.availability.frames !== 'unavailable';
    const cards = [
      components.statCard({
        label: 'Kill',
        value: totals.kills,
        hint: `${totals.headshots} headshot`
      }),
      components.statCard({
        label: 'HS %',
        value: totals.headshotPercent == null ? '—' : `${Math.round(totals.headshotPercent)}%`,
        hint: 'kill içinde headshot oranı'
      }),
      components.statCard({
        label: 'Accuracy',
        value: impactKnown && totals.accuracy != null ? `%${Math.round(totals.accuracy)}` : '—',
        hint: impactKnown ? `${totals.impacts}/${totals.shots} isabet (bullet_impact)` : 'bullet_impact yok'
      }),
      components.statCard({
        label: 'Hasar',
        value: Math.round(totals.damage),
        hint: 'player_hurt toplamı'
      }),
      components.statCard({
        label: 'Ort. kill mesafesi',
        value: totals.avgKillDistance == null ? '—' : `${Math.round(totals.avgKillDistance)} u`,
        hint: totals.avgKillDistance == null ? 'konum verisi yok' : 'oyuncu konumlarından'
      }),
      components.statCard({
        label: 'Hareket halinde atış',
        value: framesKnown && totals.movingShotRate != null ? `%${Math.round(totals.movingShotRate)}` : '—',
        hint: framesKnown ? `>60 birim/s hızla atılan mermi` : 'tick state yok'
      }),
      components.statCard({
        label: 'Crosshair açı hatası',
        value: framesKnown && totals.crosshairErrorDeg != null ? `${fmt(totals.crosshairErrorDeg, 1)}°` : '—',
        hint: framesKnown ? crosshairLabel(totals.crosshairErrorDeg, aim.thresholds) : 'kamera açısı (tick state) yok',
        tone: crosshairTone(totals.crosshairErrorDeg, aim.thresholds)
      }),
      components.statCard({
        label: 'Potential reaction',
        value: framesKnown && totals.potentialReactionMs != null ? `${Math.round(totals.potentialReactionMs)} ms` : '—',
        hint: framesKnown ? 'koniye giriş → ilk atış (kesin tepki süresi değil)' : 'tick state yok',
        tone: 'warn'
      })
    ];
    return components.statGrid(cards);
  }

  function buildHeatmap(model, aim, duels) {
    const filter = ns.filters.get();
    const round = activeRound(model);
    const points = [];

    for (const event of model.events.impacts || []) {
      if (filter.playerSteamId && String(event.actorSteamId) !== String(filter.playerSteamId)) continue;
      if (round && Number(event.round) !== Number(round.number)) continue;
      if (filter.weapon && filter.weapon !== 'all' && event.weapon && event.weapon !== filter.weapon) continue;
      if (!event.position) continue;
      points.push({
        id: `impact:${event.tick}:${event.actorSteamId}`,
        kind: 'impact',
        x: event.position.x,
        y: event.position.y,
        tick: event.tick,
        team: '',
        event,
        style: { color: 'rgba(200, 205, 212, .55)', radius: 3, label: 'İsabet' }
      });
    }

    for (const duel of duels) {
      const kill = (model.events.kills || []).find((event) => event.tick === duel.tick
        && String(event.actorSteamId) === duel.attackerSteamId
        && String(event.targetSteamId) === duel.victimSteamId);
      const position = kill?.position;
      if (!position) continue;
      points.push({
        id: `kill:${duel.id}`,
        kind: 'kill',
        x: position.x,
        y: position.y,
        tick: duel.tick,
        team: '',
        event: kill,
        style: {
          color: duel.headshot ? '#d98b7a' : '#c9d17a',
          radius: 6,
          label: duel.headshot ? 'Kill (HS)' : 'Kill'
        }
      });
    }

    if (!radarNode) {
      radarNode = components.radar({ size: 320 });
    }
    radarNode.update(points);
    return el('div', { class: 'radar-wrap' }, [
      radarNode,
      el('div', { class: 'radar-caption', text: points.length ? 'İsabet noktaları + kill konumları' : 'Konum verisi yok' })
    ]);
  }

  function buildWeaponTable(aim, rows) {
    const columns = [
      { key: 'label', label: 'Silah' },
      { key: 'kills', label: 'Kill', align: 'right' },
      { key: 'headshots', label: 'HS', align: 'right' },
      { key: 'headshotPercent', label: 'HS %', align: 'right', value: (row) => `${row.headshotPercent}%` },
      { key: 'damage', label: 'Hasar', align: 'right' }
    ];
    if (aim.availability.shots !== 'unavailable') {
      columns.push({ key: 'shots', label: 'Atış', align: 'right' });
    }
    if (aim.availability.impacts !== 'unavailable') {
      columns.push(
        { key: 'hits', label: 'İsabet', align: 'right' },
        { key: 'accuracy', label: 'İsabet %', align: 'right', value: (row) => (row.accuracy == null ? '—' : `%${Math.round(row.accuracy)}`) }
      );
    }
    if (rows.some((row) => row.blindKills > 0)) {
      columns.push({ key: 'blindKills', label: 'Kör kill', align: 'right' });
    }

    return components.dataTable({
      columns,
      rows: sortedRows(rows, weaponSort),
      sort: weaponSort,
      onSort: (next) => {
        weaponSort = next;
        requestRender();
      },
      emptyText: 'Bu filtre için silah verisi yok',
      caption: 'Sütunlar yalnızca ilgili veri varsa gösterilir'
    });
  }

  function buildPlayerTable(model, aim) {
    const filter = ns.filters.get();
    const rows = aim.players.map((player) => ({
      steamId: player.steamId,
      name: player.name || player.steamId,
      team: player.teamName || '—',
      kills: player.kills,
      headshotPercent: player.headshotPercent,
      damage: player.damage,
      adr: player.adr,
      shots: player.shots,
      accuracy: player.accuracy,
      avgKillDistance: player.avgKillDistance,
      movingShotRate: player.movingShotRate,
      crosshairErrorDeg: player.crosshairErrorDeg,
      potentialReactionMs: player.potentialReactionMs
    }));

    const columns = [
      { key: 'name', label: 'Oyuncu' },
      { key: 'team', label: 'Takım' },
      { key: 'kills', label: 'K', align: 'right' },
      { key: 'headshotPercent', label: 'HS %', align: 'right', value: (row) => `${row.headshotPercent}%` },
      { key: 'damage', label: 'Hasar', align: 'right' }
    ];
    if (model.availability.damage?.available) {
      columns.push({ key: 'adr', label: 'ADR', align: 'right', value: (row) => fmt(row.adr, 1) });
    }
    if (aim.availability.shots !== 'unavailable') {
      columns.push({ key: 'shots', label: 'Atış', align: 'right' });
    }
    if (aim.availability.impacts !== 'unavailable') {
      columns.push({
        key: 'accuracy',
        label: 'İsabet %',
        align: 'right',
        value: (row) => (row.accuracy == null ? '—' : `%${Math.round(row.accuracy)}`)
      });
    }
    if (rows.some((row) => row.avgKillDistance != null)) {
      columns.push({ key: 'avgKillDistance', label: 'Mesafe', align: 'right', value: (row) => fmt(row.avgKillDistance, 0) });
    }
    if (rows.some((row) => row.movingShotRate != null)) {
      columns.push({
        key: 'movingShotRate',
        label: 'Hareket %',
        align: 'right',
        value: (row) => (row.movingShotRate == null ? '—' : `%${Math.round(row.movingShotRate)}`)
      });
    }
    if (rows.some((row) => row.crosshairErrorDeg != null)) {
      columns.push({
        key: 'crosshairErrorDeg',
        label: 'Açı hatası',
        align: 'right',
        value: (row) => (row.crosshairErrorDeg == null ? '—' : `${fmt(row.crosshairErrorDeg, 1)}°`)
      });
    }
    if (rows.some((row) => row.potentialReactionMs != null)) {
      columns.push({
        key: 'potentialReactionMs',
        label: 'Reaction*',
        align: 'right',
        title: 'Potential reaction time: kesin tepki süresi değil',
        value: (row) => (row.potentialReactionMs == null ? '—' : `${Math.round(row.potentialReactionMs)} ms`)
      });
    }

    const selected = filter.playerSteamId;
    return components.dataTable({
      columns,
      rows: sortedRows(rows, playerSort),
      sort: playerSort,
      onSort: (next) => {
        playerSort = next;
        requestRender();
      },
      emptyText: 'Bu filtre için oyuncu verisi yok',
      rowClass: (row) => (selected && row.steamId === selected ? 'is-selected' : ''),
      onRowClick: (row) => ns.filters.set({ playerSteamId: row.steamId === selected ? '' : row.steamId }),
      caption: 'Aim metrikleri — * potential reaction time'
    });
  }

  function buildDuelList(model, aim, duels) {
    const rows = duels;
    const list = components.eventList({
      rows,
      emptyText: 'Bu filtre için düello yok',
      renderRow: (duel) => {
        const badges = [
          { text: duel.weaponLabel || duel.weapon || '?', tone: 'neutral' },
          duel.round != null ? { text: `R${duel.round}`, tone: 'neutral' } : null,
          duel.headshot ? { text: 'HS', tone: 'good' } : null,
          duel.attackerBlind ? { text: 'KÖR ATIŞ', tone: 'warn' } : null,
          duel.thruSmoke ? { text: 'SMOKE', tone: 'warn' } : null,
          duel.attackerInAir ? { text: 'HAVADA', tone: 'warn' } : null
        ];
        const meta = [
          `tick ${Math.round(duel.tick)}`,
          formatClock(duel.tick / (model.match?.tickRate || 64)),
          duel.distance != null ? `${Math.round(duel.distance)} u` : 'mesafe yok',
          duel.shotCount ? `${duel.shotCount} atış` : 'atış verisi yok',
          duel.damage ? `${Math.round(duel.damage)} hasar` : null,
          duel.crosshairErrorDeg != null ? `açı ${fmt(duel.crosshairErrorDeg, 1)}°` : null,
          duel.potentialReactionMs != null
            ? `reaction* ${Math.round(duel.potentialReactionMs)} ms`
            : (duel.reactionReason === 'target-already-visible' ? 'reaction* ölçülemedi' : null)
        ].filter(Boolean);

        return components.eventRow({
          title: `${duel.attackerName || '—'} → ${duel.victimName || '—'}`,
          meta,
          badges,
          action: replayButton(duel.jumpTick ?? duel.tick, duel.attackerSteamId),
          tone: selectedDuelId === duel.id ? 'selected' : ''
        });
      },
      onRowClick: (duel) => {
        selectedDuelId = selectedDuelId === duel.id ? null : duel.id;
        if (selectedDuelId) ns.replay.jumpTo(duel.jumpTick ?? duel.tick, { steamId: duel.attackerSteamId });
        requestRender();
      }
    });
    return el('div', { class: 'event-block' }, [list]);
  }

  function buildNotes(model, aim) {
    const notes = [];
    if (aim.availability.frames === 'unavailable') {
      notes.push('tick state yok: crosshair açı hatası, hareket halinde atış ve reaction time hesaplanamadı.');
    }
    if (aim.availability.impacts === 'unavailable') {
      notes.push(`bullet_impact: ${model.availability?.impacts?.error || 'veri yok'} — accuracy/isabet gizlendi.`);
    }
    if (aim.availability.shots === 'unavailable') {
      notes.push(`weapon_fire: ${model.availability?.shots?.error || 'veri yok'} — atış sayıları gizlendi.`);
    }
    if (aim.availability.damage === 'unavailable') {
      notes.push(`player_hurt: ${model.availability?.damage?.error || 'veri yok'} — hasar/ADR gizlendi.`);
    }
    notes.push('Visibility (raycast) doğrulaması yapılmıyor: reaction süresi "potential" etiketlidir.');
    for (const warning of aim.warnings || []) notes.push(warning);
    return el('div', { class: 'data-notes' }, [
      el('span', { class: 'data-notes-title', text: 'Doğruluk sınırları' }),
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
        'Aim metrikleri (accuracy, crosshair hatası, düello listesi) için önce bir demo yükle.',
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

    const aim = aimModelFor(model);
    if (!aim.available) {
      container.appendChild(components.noDataset(
        'Bu demo aim metriklerini sağlamıyor.',
        [aim.reason || 'player_death / weapon_fire verisi yok']
      ));
      dirty = false;
      return;
    }

    const duels = filteredDuels(model, aim);
    const weapons = weaponRows(model, aim);
    const filter = ns.filters.get();
    const weaponOptions = [...new Map(aim.players.flatMap((player) => player.weapons || [])
      .map((weapon) => [weapon.key, { key: weapon.key, label: weapon.label }])).values()];

    const toolbar = components.toolbar([
      components.roundFilter(model),
      components.playerFilter(model),
      components.sideFilter(),
      weaponOptions.length ? components.weaponFilter(weaponOptions) : null,
      el('div', { class: 'toolbar-spacer' }),
      el('span', {
        class: 'toolbar-note',
        text: `${model.match.map || 'map yok'} · ${duels.length} düello · ${weapons.length} silah`
      }),
      filter.playerSteamId || filter.weapon !== 'all'
        ? el('button', {
          type: 'button',
          class: 'btn secondary mini',
          text: 'Seçimi temizle',
          onclick: () => ns.filters.set({ playerSteamId: '', weapon: 'all' })
        })
        : null
    ]);

    const body = el('div', { class: 'view-body' }, [
      section('Özet', buildSummary(aim, duels)),
      section('Isı haritası', buildHeatmap(model, aim, duels)),
      section('Silah dağılımı', buildWeaponTable(aim, weapons)),
      section('Oyuncular', buildPlayerTable(model, aim)),
      section('Düellolar', buildDuelList(model, aim, duels))
    ]);

    body.appendChild(buildNotes(model, aim));
    container.append(toolbar, body);
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
    invalidate: requestRender
  });

  ns.bus.on('demo:changed', () => {
    cachedModel = null;
    lastAimModel = null;
    selectedDuelId = null;
    requestRender();
  });
  ns.bus.on('demo:cleared', () => {
    cachedModel = null;
    lastAimModel = null;
    selectedDuelId = null;
    requestRender();
  });
  ns.filters.subscribe(() => requestRender());

  ns.aimView = { requestRender, isActive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
