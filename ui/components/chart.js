/*
 * Basit SVG grafik bileşenleri (bağımlılık yok).
 *
 * momentumChart: round bazında skor farkı (T pozitif / CT negatif) + kazanma serileri.
 * jsdom / SVG desteklemeyen ortamlarda hata vermez (boş kapsayıcı döner).
 */
(function (root) {
  'use strict';
  const { el } = root.MF.dom;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(tag, props = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(child);
    }
    return node;
  }

  /*
   * config: {
   *   rounds: [{ number, diff, winnerSide, scoreT, scoreCT, streakLength }],
   *   height, barWidth, colors: { T, CT }
   * }
   */
  function momentumChart(config = {}) {
    const rounds = Array.isArray(config.rounds) ? config.rounds : [];
    const height = config.height || 150;
    const barWidth = config.barWidth || 26;
    const colors = { T: '#c4a574', CT: '#7a9bb8', ...(config.colors || {}) };
    const width = Math.max(120, rounds.length * (barWidth + 6) + 16);

    const wrapper = el('div', { class: 'chart' });
    if (!rounds.length) {
      wrapper.appendChild(el('div', { class: 'chart-empty', text: config.emptyText || 'Momentum için round verisi yok' }));
      return wrapper;
    }

    const maxDiff = Math.max(1, ...rounds.map((round) => Math.abs(Number(round.diff) || 0)));
    const mid = height / 2;
    const scale = (height / 2 - 12) / maxDiff;

    const chart = svg('svg', {
      class: 'chart-svg',
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height,
      role: 'img',
      'aria-label': 'Round bazında skor farkı'
    });

    // Orta çizgi
    chart.appendChild(svg('line', {
      x1: 0, y1: mid, x2: width, y2: mid,
      stroke: 'rgba(255,255,255,.12)', 'stroke-width': 1
    }));

    rounds.forEach((round, index) => {
      const x = 8 + index * (barWidth + 6);
      const diff = Number(round.diff) || 0;
      const barHeight = Math.max(2, Math.abs(diff) * scale);
      const y = diff >= 0 ? mid - barHeight : mid;
      const color = diff >= 0 ? colors.T : colors.CT;
      const bar = svg('rect', {
        x, y, width: barWidth, height: barHeight,
        rx: 2,
        fill: color,
        opacity: 0.85
      });
      const title = svg('title');
      title.textContent = `Round ${round.number} · ${round.winnerSide || '?' } kazandı · ${round.scoreT}-${round.scoreCT}`;
      bar.appendChild(title);
      chart.appendChild(bar);

      const label = svg('text', {
        x: x + barWidth / 2,
        y: height - 4,
        'text-anchor': 'middle',
        fill: 'rgba(255,255,255,.35)',
        'font-size': 9
      });
      label.textContent = String(round.number);
      chart.appendChild(label);

      if (round.streakLength >= 2) {
        const dot = svg('circle', {
          cx: x + barWidth / 2,
          cy: diff >= 0 ? y - 5 : y + barHeight + 5,
          r: 2.5,
          fill: '#e8e8ea'
        });
        const dotTitle = svg('title');
        dotTitle.textContent = `${round.streakLength} roundlık ${round.winnerSide} serisi`;
        dot.appendChild(dotTitle);
        chart.appendChild(dot);
      }
    });

    wrapper.appendChild(chart);
    wrapper.appendChild(el('div', { class: 'chart-caption' }, [
      el('span', { class: 'chart-legend' }, [
        el('i', { class: 'radar-dot', style: { background: colors.T } }),
        el('span', { text: 'T önde' })
      ]),
      el('span', { class: 'chart-legend' }, [
        el('i', { class: 'radar-dot', style: { background: colors.CT } }),
        el('span', { text: 'CT önde' })
      ]),
      el('span', { class: 'chart-note', text: 'Nokta: 2+ roundlık seri' })
    ]));
    return wrapper;
  }

  root.MF.components = root.MF.components || {};
  Object.assign(root.MF.components, { momentumChart, svg });
})(typeof globalThis !== 'undefined' ? globalThis : this);
