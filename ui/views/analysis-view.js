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
  let heatmapNode = null;

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

  /* ------------------------------------------------------------------ *
   * Aşama 7.1 bölümleri: ekonomi, taraf dağılımı, momentum, ısı haritası,
   * opening düello. Tümü veri yoksa gizlenir / açıklama gösterir.
   * ------------------------------------------------------------------ */

  const BUY_LABELS = { pistol: 'Pistol', eco: 'Eco', force: 'Force', full: 'Full', unknown: '—' };

  function buildEconomy(model) {
    if (!model.availability.purchases?.available) {
      return components.emptyState({
        kind: 'warn',
        title: 'Ekonomi verisi yok',
        message: model.availability.purchases?.error || 'item_purchase eventleri bu demo için parse edilmedi.',
        details: ['Round başı harcama, eco/force/full dağılımı ve alım-kazanma ilişkisi bu veriyle hesaplanır.']
      });
    }
    const economy = analysis.buildEconomyModel(model);
    if (!economy.available) return components.emptyState({ kind: 'warn', title: 'Ekonomi hesaplanamadı' });

    const filters = ns.filters.get();
    const rows = economy.rounds.map((round) => ({
      number: round.number,
      jumpTick: round.jumpTick,
      tSpend: Math.round(round.bySide.T.spend),
      tBuy: BUY_LABELS[round.bySide.T.buy] || round.bySide.T.buy,
      tPerPlayer: round.bySide.T.spendPerPlayer != null ? Math.round(round.bySide.T.spendPerPlayer) : null,
      ctSpend: Math.round(round.bySide.CT.spend),
      ctBuy: BUY_LABELS[round.bySide.CT.buy] || round.bySide.CT.buy,
      ctPerPlayer: round.bySide.CT.spendPerPlayer != null ? Math.round(round.bySide.CT.spendPerPlayer) : null,
      winner: round.winnerSide || '—',
      delta: Math.round(round.spendDelta)
    }));

    const cards = components.statGrid([
      components.statCard({
        label: 'Toplam harcama',
        value: Math.round(economy.totals.spend).toLocaleString('tr-TR'),
        hint: `${economy.totals.buys} satın alma`
      }),
      components.statCard({
        label: 'Round başı harcama',
        value: Math.round(economy.totals.spend / Math.max(1, economy.roundCount)).toLocaleString('tr-TR'),
        hint: 'iki takım toplamı'
      }),
      components.statCard({ label: 'Full buy', value: economy.totals.full, hint: 'round · takım bazında' }),
      components.statCard({ label: 'Force buy', value: economy.totals.force }),
      components.statCard({ label: 'Eco', value: economy.totals.eco }),
      components.statCard({
        label: 'Fazla harcayan kazandı',
        value: `${Math.round((economy.rounds.filter((round) => round.wonByHigherSpend).length / Math.max(1, economy.roundCount)) * 100)}%`,
        hint: 'harcama üstünlüğü → round'
      })
    ]);

    const table = components.dataTable({
      columns: [
        { key: 'number', label: 'Round', align: 'right' },
        { key: 'tSpend', label: 'T harcama', align: 'right', value: (row) => row.tSpend.toLocaleString('tr-TR') },
        { key: 'tBuy', label: 'T alım' },
        { key: 'ctSpend', label: 'CT harcama', align: 'right', value: (row) => row.ctSpend.toLocaleString('tr-TR') },
        { key: 'ctBuy', label: 'CT alım' },
        { key: 'delta', label: 'Fark', align: 'right', value: (row) => (row.delta > 0 ? `+${row.delta.toLocaleString('tr-TR')}` : row.delta.toLocaleString('tr-TR')) },
        { key: 'winner', label: 'Kazanan', value: (row) => row.winner }
      ],
      rows,
      emptyText: 'Round ekonomi verisi yok',
      caption: `Eşikler: eco < ${economy.thresholds.buy.eco}$, full ≥ ${economy.thresholds.buy.full}$ (oyuncu başı)`
    });

    return el('div', { class: 'block-body stack' }, [cards, table]);
  }

  function buildSideSplit(model) {
    const split = analysis.buildSideSplitModel(model);
    if (!split.available) {
      return components.emptyState({ kind: 'warn', title: 'Taraf dağılımı yok', message: 'Round verisi gerekli.' });
    }

    const teamRows = [];
    for (const team of split.teams) {
      for (const side of ['T', 'CT']) {
        const stats = team[side];
        teamRows.push({
          team: team.name,
          side,
          rounds: stats.rounds,
          wins: stats.wins,
          winPercent: stats.winPercent != null ? Math.round(stats.winPercent) : null,
          kills: stats.kills,
          deaths: stats.deaths,
          adr: stats.adr != null ? Math.round(stats.adr) : null,
          entryKills: stats.entryKills,
          entryDeaths: stats.entryDeaths
        });
      }
    }

    const playerRows = split.players.map((player) => ({
      steamId: player.steamId,
      name: player.name,
      tRounds: player.T.rounds,
      tKills: player.T.kills,
      tDeaths: player.T.deaths,
      tAdr: player.T.adr != null ? Math.round(player.T.adr) : null,
      ctRounds: player.CT.rounds,
      ctKills: player.CT.kills,
      ctDeaths: player.CT.deaths,
      ctAdr: player.CT.adr != null ? Math.round(player.CT.adr) : null
    }));

    const selected = ns.filters.get().playerSteamId;
    return el('div', { class: 'block-body stack' }, [
      components.dataTable({
        columns: [
          { key: 'team', label: 'Takım' },
          { key: 'side', label: 'Taraf' },
          { key: 'rounds', label: 'Round', align: 'right' },
          { key: 'wins', label: 'W', align: 'right' },
          { key: 'winPercent', label: 'W %', align: 'right', value: (row) => (row.winPercent == null ? '—' : `${row.winPercent}%`) },
          { key: 'kills', label: 'K', align: 'right' },
          { key: 'deaths', label: 'D', align: 'right' },
          { key: 'adr', label: 'ADR', align: 'right', value: (row) => (row.adr == null ? '—' : row.adr) },
          { key: 'entryKills', label: 'Entry K', align: 'right' },
          { key: 'entryDeaths', label: 'Entry D', align: 'right' }
        ],
        rows: teamRows,
        emptyText: 'Takım verisi yok',
        caption: 'Devre arası taraf değişimi round bazında hesaba katılır'
      }),
      components.dataTable({
        columns: [
          { key: 'name', label: 'Oyuncu' },
          { key: 'tRounds', label: 'T round', align: 'right' },
          { key: 'tKills', label: 'T K', align: 'right' },
          { key: 'tDeaths', label: 'T D', align: 'right' },
          { key: 'tAdr', label: 'T ADR', align: 'right', value: (row) => (row.tAdr == null ? '—' : row.tAdr) },
          { key: 'ctRounds', label: 'CT round', align: 'right' },
          { key: 'ctKills', label: 'CT K', align: 'right' },
          { key: 'ctDeaths', label: 'CT D', align: 'right' },
          { key: 'ctAdr', label: 'CT ADR', align: 'right', value: (row) => (row.ctAdr == null ? '—' : row.ctAdr) }
        ],
        rows: playerRows,
        emptyText: 'Oyuncu verisi yok',
        rowClass: (row) => (selected && row.steamId === selected ? 'is-selected' : ''),
        onRowClick: (row) => ns.filters.set({ playerSteamId: row.steamId === selected ? '' : row.steamId }),
        caption: 'ADR yalnızca player_hurt verisi varsa gösterilir'
      })
    ]);
  }

  function buildMomentum(model) {
    const momentum = analysis.buildMomentumModel(model);
    if (!momentum.available) {
      return components.emptyState({ kind: 'warn', title: 'Momentum verisi yok', message: 'Round sonuçları gerekli.' });
    }
    const chart = components.momentumChart({ rounds: momentum.rounds, height: 150 });
    const summary = el('div', { class: 'momentum-summary' }, [
      el('span', { class: 'toolbar-note', text: `En uzun seri: T ${momentum.longestStreak.T} · CT ${momentum.longestStreak.CT}` }),
      momentum.biggestLead.round
        ? el('span', {
          class: 'toolbar-note',
          text: `En büyük fark: R${momentum.biggestLead.round} · ${momentum.biggestLead.side} +${Math.abs(momentum.biggestLead.diff)}`
        })
        : null
    ]);
    return el('div', { class: 'block-body stack' }, [chart, summary]);
  }

  function buildHeatmap(model) {
    const heatmap = analysis.buildMatchHeatmap(model);
    if (!heatmap.available) {
      return components.emptyState({
        kind: 'warn',
        title: 'Isı haritası yok',
        message: heatmap.warnings[0] || 'Kill konumları bu demoda bulunmuyor.',
        details: ['Harita görseli MVP kapsamı dışında; noktalar demoparser dünya koordinatlarında çizilir.']
      });
    }
    const points = heatmap.points.map((point) => ({
      id: `${point.kind}:${point.tick}:${point.steamId}`,
      kind: point.kind,
      x: point.x,
      y: point.y,
      tick: point.tick,
      event: point,
      style: point.kind === 'kill'
        ? { color: 'rgba(201, 209, 122, .75)', radius: 5, label: 'Kill (atan)' }
        : { color: 'rgba(217, 139, 122, .8)', radius: 4, label: 'Ölüm' }
    }));
    if (!heatmapNode) heatmapNode = components.radar({ size: 320 });
    heatmapNode.update(points);
    return el('div', { class: 'block-body stack' }, [
      el('div', { class: 'radar-wrap' }, [
        heatmapNode,
        el('div', { class: 'radar-caption', text: `${points.length} nokta · maç geneli (harita görseli yok)` })
      ])
    ]);
  }

  function buildOpenings(model) {
    const openings = analysis.buildOpeningDuels(model);
    if (!openings.available) {
      return components.emptyState({ kind: 'warn', title: 'Opening düello yok', message: 'Entry kill verisi bulunamadı.' });
    }
    const rows = openings.duels.map((duel) => ({ ...duel }));
    const list = components.eventList({
      rows,
      emptyText: 'Opening düello yok',
      renderRow: (duel) => components.eventRow({
        title: `${duel.attackerName || '—'} → ${duel.victimName || '—'}`,
        meta: [
          `R${duel.round}`,
          `tick ${Math.round(duel.tick)}`,
          duel.weaponLabel || duel.weapon,
          `${duel.attackerSide || '?'} açılış`,
          duel.roundWonByAttackerSide ? 'round kazanıldı' : 'round kaybedildi'
        ],
        badges: [
          { text: duel.attackerSide || '?', tone: String(duel.attackerSide || '').toLowerCase() },
          duel.headshot ? { text: 'HS', tone: 'good' } : null,
          duel.traded ? { text: 'TRADE', tone: 'warn' } : null
        ],
        action: replayButton(duel.jumpTick, duel.attackerSteamId)
      })
    });
    return el('div', { class: 'block-body stack' }, [
      components.statGrid([
        components.statCard({
          label: 'T açılış üstünlüğü',
          value: openings.bySide.T.successPercent != null ? `${Math.round(openings.bySide.T.successPercent)}%` : '—',
          hint: `${openings.bySide.T.attempts} açılış · ${openings.bySide.T.won} round`
        }),
        components.statCard({
          label: 'CT açılış üstünlüğü',
          value: openings.bySide.CT.successPercent != null ? `${Math.round(openings.bySide.CT.successPercent)}%` : '—',
          hint: `${openings.bySide.CT.attempts} açılış · ${openings.bySide.CT.won} round`
        }),
        components.statCard({ label: 'Opening round', value: `${openings.roundsWithEntry}/${openings.roundCount}` })
      ]),
      list
    ]);
  }

  function buildDataNotes(model) {
    const notes = (model.notes || []).map((note) => `${note.dataset}: ${note.message}`);

    // Aşama 8: Rust gölge karşılaştırma açıksa sonucu burada gösterilir.
    const parity = ns.store.getRustParity?.();
    if (parity) {
      if (parity.pending) notes.push('Rust modeli: karşılaştırılıyor…');
      else if (parity.message) notes.push(`Rust modeli: alınamadı (${parity.message})`);
      else if (parity.ok) notes.push(`Rust modeli: ${parity.checked} alanda JS ile aynı (${parity.engine})`);
      else {
        const first = parity.mismatches?.[0];
        notes.push(`Rust modeli: ${parity.mismatches.length} fark — ${first.field} JS ${first.js} / Rust ${first.rust}`);
      }
    }

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
      section(activeRound(model) ? 'Round olayları' : 'Maç olayları', buildRoundEvents(model)),
      section('Ekonomi', buildEconomy(model)),
      section('Taraf dağılımı (T / CT)', buildSideSplit(model)),
      section('Round momentum', buildMomentum(model)),
      section('Isı haritası', buildHeatmap(model)),
      section('Opening düellolar', buildOpenings(model))
    ]);

    // Koçluk notları (Ruby motoru; yoksa uyarı gösterir, ekran çalışmaya devam eder)
    ns.analysis.coaching.ensure(model, { playerSteamId: filter.playerSteamId || '' });
    body.appendChild(components.coachSection({
      title: 'Koçluk notları',
      categories: null,
      note: filter.playerSteamId
        ? 'Seçili oyuncunun metrikleri Ruby kural motoruna gönderilir.'
        : 'Maç geneli metrikler Ruby kural motoruna gönderilir.'
    }));

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
  ns.bus.on('analysis:rust', requestRender);
  ns.filters.subscribe(() => requestRender());

  ns.analysisView = { requestRender, isActive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
