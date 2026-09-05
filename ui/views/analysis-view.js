/*
 * Analysis ekranı — maçın genel performans özeti.
 *
 * Durumlar:
 *   1) demo yok                 → "Analiz için bir demo yükle"
 *   2) demo var, metrik yok     → "Bu demo bu metriği sağlamıyor" + sebep
 *   3) veri hazır               → özet kartları, takım/oyuncu tabloları, round listesi
 *
 * Her olay satırı replay'e atlayabilir.
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
  let eventLimit = 40;

  function dash(value) {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
    return String(value);
  }

  function isActive() {
    return ns.navigation.current() === 'analysis';
  }

  function requestRender() {
    dirty = true;
    if (isActive()) render();
  }

  function activeRound(model) {
    const { round } = ns.filters.get();
    if (round === 'all') return null;
    return model.rounds.find((entry) => Number(entry.number) === Number(round)) || null;
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
   * Bölümler
   * ------------------------------------------------------------------ */

  function buildSummary(model) {
    const round = activeRound(model);
    if (round) {
      return components.statGrid([
        components.statCard({ label: 'Kazanan', value: round.winnerSide || '—', hint: round.reason || '', tone: String(round.winnerSide || '').toLowerCase() }),
        components.statCard({ label: 'Round süresi', value: formatClock(round.durationSeconds) }),
        components.statCard({ label: 'Kill', value: round.kills.length, hint: `${round.survivors.T} T / ${round.survivors.CT} CT hayatta` }),
        components.statCard({ label: 'Bomba', value: round.bombExploded ? 'Patladı' : round.bombDefused ? 'İmha' : round.bombPlanted ? 'Kuruldu' : '—' }),
        components.statCard({
          label: 'Clutch',
          value: round.clutch ? `1v${round.clutch.opponents}` : '—',
          hint: round.clutch ? (round.clutch.won ? 'kazanıldı' : 'kaybedildi') : 'clutch durumu yok'
        }),
        components.statCard({
          label: 'İlk kill',
          value: round.entryKill ? round.entryKill.attackerName || '—' : '—',
          hint: round.entryKill ? `${round.entryKill.weaponLabel || ''} → ${round.entryKill.victimName || ''}`.trim() : ''
        })
      ]);
    }

    const totals = model.teams.reduce((accumulator, team) => {
      accumulator.kills += team.totals.kills;
      accumulator.deaths += team.totals.deaths;
      accumulator.plants += team.totals.plants;
      accumulator.defuses += team.totals.defuses;
      return accumulator;
    }, { kills: 0, deaths: 0, plants: 0, defuses: 0 });

    return components.statGrid([
      components.statCard({ label: 'Round', value: model.match.roundsPlayed, hint: `${model.match.scoreBySide.T} T · ${model.match.scoreBySide.CT} CT kazandı` }),
      components.statCard({ label: 'Toplam kill', value: totals.kills }),
      components.statCard({ label: 'Toplam ölüm', value: totals.deaths }),
      components.statCard({ label: 'Plant', value: totals.plants }),
      components.statCard({ label: 'Defuse', value: totals.defuses }),
      components.statCard({ label: 'Maç süresi', value: formatClock(model.match.durationSeconds), hint: `${model.match.tickRate} tick/s` })
    ]);
  }

  function teamRowForRound(model, team, round) {
    const side = round.teamBySide.T === team.id ? 'T' : round.teamBySide.CT === team.id ? 'CT' : '';
    const roster = new Set(side ? round.roster[side] || [] : []);
    let kills = 0;
    let deaths = 0;
    let damage = 0;
    for (const member of team.players) {
      const row = model.players[member]?.rounds?.[String(round.number)] || null;
      if (!row) continue;
      kills += row.kills;
      deaths += row.deaths;
      damage += row.damage || 0;
    }
    const entryKill = round.entryKill;
    const entryKills = entryKill && roster.has(entryKill.attackerSteamId) ? 1 : 0;
    const entryDeaths = entryKill && side && roster.has(entryKill.victimSteamId) ? 1 : 0;
    return {
      name: team.name,
      score: round.scoreAfter?.[team.id] ?? team.score,
      kills,
      deaths,
      assists: 0,
      entryKills,
      entryDeaths,
      entrySuccessPercent: entryKills + entryDeaths ? Math.round((entryKills / (entryKills + entryDeaths)) * 100) : 0,
      headshotPercent: 0,
      clutchWon: round.clutch && round.clutch.won && round.clutch.playerTeamId === team.id ? 1 : 0,
      clutchAttempts: round.clutch && round.clutch.playerTeamId === team.id ? 1 : 0,
      adr: model.availability.damage.available ? Number((damage / Math.max(1, team.players.length)).toFixed(1)) : null
    };
  }

  function buildTeamTable(model) {
    const columns = [
      { key: 'name', label: 'Takım' },
      { key: 'score', label: 'Skor', align: 'right' },
      { key: 'kills', label: 'K', align: 'right' },
      { key: 'deaths', label: 'D', align: 'right' },
      { key: 'assists', label: 'A', align: 'right' },
      { key: 'entry', label: 'Entry', align: 'right', value: (row) => `${row.entryKills}/${row.entryDeaths}` },
      { key: 'entrySuccessPercent', label: 'Entry %', align: 'right', value: (row) => `${row.entrySuccessPercent}%` },
      { key: 'headshotPercent', label: 'HS %', align: 'right', value: (row) => `${row.headshotPercent}%` }
    ];
    if (model.availability.damage.available) {
      columns.push({ key: 'adr', label: 'ADR', align: 'right', value: (row) => dash(row.adr) });
    }
    columns.push({ key: 'clutch', label: 'Clutch', align: 'right', value: (row) => `${row.clutchWon}/${row.clutchAttempts}` });

    const round = activeRound(model);
    const rows = round
      ? model.teams.map((team) => teamRowForRound(model, team, round))
      : model.teams.map((team) => ({ name: team.name, score: team.score, ...team.totals }));

    return components.dataTable({
      columns,
      rows,
      emptyText: 'Takım verisi yok',
      caption: round ? `Round ${round.number} · takım bazında` : 'Tüm maç · takım bazında'
    });
  }

  function buildPlayerTable(model) {
    const filter = ns.filters.get();
    const rows = analysis.playerRows(model, { round: filter.round, side: filter.side });

    const columns = [
      { key: 'name', label: 'Oyuncu' },
      { key: 'team', label: 'Takım', value: (row) => row.team || row.side || '—' },
      { key: 'kills', label: 'K', align: 'right' },
      { key: 'deaths', label: 'D', align: 'right' },
      { key: 'assists', label: 'A', align: 'right' },
      { key: 'kd', label: 'K/D', align: 'right', value: (row) => formatNumber(row.kd, 2) },
      { key: 'headshotPercent', label: 'HS %', align: 'right', value: (row) => `${row.headshotPercent}%` },
      { key: 'entryKills', label: 'Entry', align: 'right' },
      { key: 'tradeKills', label: 'Trade', align: 'right' }
    ];

    if (model.availability.damage.available) {
      columns.splice(6, 0, { key: 'adr', label: 'ADR', align: 'right', value: (row) => dash(row.adr) });
    }
    if (rows.some((row) => row.flashAssists > 0)) {
      columns.push({ key: 'flashAssists', label: 'Flash assist', align: 'right' });
    }
    if (rows.some((row) => row.clutches.attempts > 0)) {
      columns.push({
        key: 'clutches',
        label: 'Clutch',
        align: 'right',
        value: (row) => `${row.clutches.won}/${row.clutches.attempts}`
      });
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

    const selected = filter.playerSteamId;
    return components.dataTable({
      columns,
      rows: sorted,
      sort: playerSort,
      onSort: (next) => {
        playerSort = next;
        requestRender();
      },
      emptyText: 'Bu filtre için oyuncu verisi yok',
      rowClass: (row) => (selected && row.steamId === selected ? 'is-selected' : ''),
      onRowClick: (row) => {
        ns.filters.set({ playerSteamId: row.steamId === selected ? '' : row.steamId });
      },
      caption: filter.round === 'all' ? 'Tüm maç' : `Round ${filter.round}`
    });
  }

  function buildRoundList(model) {
    const rows = analysis.roundRows(model);
    const filter = ns.filters.get();
    const selected = Number(filter.round);

    return components.eventList({
      rows,
      emptyText: 'Round verisi yok',
      renderRow: (row) => {
        const firstKill = row.firstKill
          ? `${row.firstKill.attackerName || '?'} → ${row.firstKill.victimName || '?'}`
          : 'ilk kill yok';
        const badges = [
          { text: row.winnerSide || '?', tone: String(row.winnerSide || '').toLowerCase() },
          row.reason ? { text: row.reason, tone: 'neutral' } : null,
          row.bombPlanted
            ? { text: row.bombExploded ? 'PATLADI' : row.bombDefused ? 'İMHA' : 'PLANT', tone: 'bomb' }
            : null,
          row.clutch
            ? { text: `1v${row.clutch.opponents}${row.clutch.won ? ' ✓' : ' ✗'}`, tone: row.clutch.won ? 'good' : 'bad' }
            : null,
          row.outcomeSource === 'inferred'
            ? { text: 'sonuç tahmini', tone: 'warn', title: 'round_end winner alanı yok; sonuç eventlerden çıkarıldı' }
            : null
        ];
        return components.eventRow({
          title: `Round ${row.number}`,
          meta: [
            formatClock(row.durationSeconds),
            `${row.kills} kill`,
            firstKill,
            `${row.survivors.T}T / ${row.survivors.CT}CT hayatta`
          ],
          badges,
          action: replayButton(row.startTick, filter.playerSteamId),
          tone: selected === row.number ? 'selected' : ''
        });
      },
      onRowClick: (row) => {
        ns.filters.set({ round: selected === row.number ? 'all' : row.number });
      }
    });
  }

  function buildRoundEvents(model) {
    const round = activeRound(model);
    const source = round
      ? [...round.kills, ...round.bomb, ...round.utility.filter((event) => event.phase === 'detonate' || event.phase === 'start')]
      : model.events.kills;
    const events = [...source].sort((a, b) => Number(a.tick) - Number(b.tick));
    const shown = events.slice(0, eventLimit);
    const filter = ns.filters.get();

    const list = components.eventList({
      rows: shown,
      emptyText: round ? 'Bu roundda olay yok' : 'Olay verisi yok',
      renderRow: (event) => {
        let label;
        if (event.type === 'kill') {
          label = `${event.actorName || '?'} → ${event.targetName || '?'}${event.headshot ? ' (HS)' : ''}`;
        } else if (event.type === 'bomb') {
          const text = { plant: 'Bomba kuruldu', defuse: 'Bomba imha edildi', explode: 'Bomba patladı', drop: 'Bomba bırakıldı', pickup: 'Bomba alındı' }[event.kind] || 'Bomba';
          label = `${text}${event.actorName ? ` · ${event.actorName}` : ''}`;
        } else {
          label = `${String(event.kind || 'utility').toUpperCase()} · ${event.actorName || '—'}`;
        }
        const meta = [
          `R${event.round ?? '—'}`,
          `tick ${Math.round(Number(event.tick) || 0)}`,
          formatClock(Number(event.tick || 0) / (model.match.tickRate || 64)),
          event.weaponLabel || ''
        ].filter(Boolean);
        return components.eventRow({
          title: label,
          meta,
          badges: event.type === 'kill' && event.isEntry ? [{ text: 'ENTRY', tone: 'good' }] : [],
          action: replayButton(event.tick, filter.playerSteamId)
        });
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

  function buildDataNotes(model) {
    const notes = (model.notes || []).map((note) => `${note.dataset}: ${note.message}`);
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
        'Round, oyuncu ve takım analizleri için önce bir demo yükle.',
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

    if (!model.availability.kills.available && !model.availability.rounds.available) {
      container.appendChild(components.noDataset(
        'Bu demoda round ve kill verisi bulunamadı; analiz için gerekli eventler parse edilemedi.',
        [
          model.availability.kills.error ? `player_death: ${model.availability.kills.error}` : null,
          model.availability.rounds.error ? `round_start: ${model.availability.rounds.error}` : null
        ].filter(Boolean)
      ));
      dirty = false;
      return;
    }

    const filter = ns.filters.get();
    const toolbar = components.toolbar([
      components.roundFilter(model),
      components.playerFilter(model),
      components.sideFilter(),
      el('div', { class: 'toolbar-spacer' }),
      el('span', {
        class: 'toolbar-note',
        text: `${model.match.map || 'map yok'} · ${model.match.roundsPlayed} round · ${model.playerOrder.length} oyuncu`
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
      section('Özet', buildSummary(model)),
      section('Takım karşılaştırması', buildTeamTable(model)),
      section('Oyuncular', buildPlayerTable(model)),
      section('Round listesi', buildRoundList(model)),
      section(activeRound(model) ? 'Round olayları' : 'Maç olayları', buildRoundEvents(model))
    ]);

    const notes = buildDataNotes(model);
    if (notes) body.appendChild(notes);

    container.append(toolbar, body);
    dirty = false;
  }

  ns.views.register({
    id: 'analysis',
    label: 'Analysis',
    mount(node) {
      container = node;
    },
    activate() {
      if (dirty || !container?.childElementCount) render();
    },
    invalidate: requestRender
  });

  ns.bus.on('demo:changed', requestRender);
  ns.bus.on('demo:cleared', requestRender);
  ns.filters.subscribe(() => requestRender());

  ns.analysisView = { requestRender, isActive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
