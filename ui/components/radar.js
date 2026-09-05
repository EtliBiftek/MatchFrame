/*
 * Radar overlay — utility (ve istenirse oyuncu) konumlarını 2B haritada gösterir.
 *
 * Saf canvas çizimi; harita koordinatları verilen noktalardan türetilir
 * (harita radar görseli MVP kapsamı dışında). jsdom / canvas desteklenmeyen
 * ortamlarda çizim yapılmaz, metin açıklaması gösterilir (hata vermez).
 */
(function (root) {
  'use strict';
  const { el, clear } = root.MF.dom;

  const KIND_STYLE = {
    smoke: { color: '#8e9aa6', radius: 12, label: 'Smoke' },
    molotov: { color: '#d98b52', radius: 9, label: 'Molotov' },
    he: { color: '#c9d17a', radius: 5, label: 'HE' },
    flash: { color: '#e4c46a', radius: 5, label: 'Flash' },
    decoy: { color: '#8f7fb0', radius: 5, label: 'Decoy' }
  };

  const TEAM_COLORS = { T: '#c4a574', CT: '#7a9bb8' };

  /*
   * config: {
   *   points: [{ id, kind, x, y, tick, team, label, active }],
   *   size: 320,
   *   onSelect(point),
   *   emptyText
   * }
   */
  function radar(config = {}) {
    const size = config.size || 320;
    const state = { points: [], bounds: null, hover: null, scale: 1 };

    const canvas = el('canvas', {
      class: 'radar-canvas',
      width: size,
      height: size,
      title: 'Radar: utility konumları (yaklaşık, harita görseli yok)'
    });
    const legend = el('div', { class: 'radar-legend' });
    const note = el('div', { class: 'radar-note', text: '' });
    const wrapper = el('div', { class: 'radar' }, [canvas, legend, note]);

    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

    function computeBounds(points) {
      const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!usable.length) return null;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of usable) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      const padX = Math.max(120, (maxX - minX) * 0.08);
      const padY = Math.max(120, (maxY - minY) * 0.08);
      return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
    }

    function project(point) {
      const bounds = state.bounds;
      if (!bounds) return null;
      const spanX = Math.max(1, bounds.maxX - bounds.minX);
      const spanY = Math.max(1, bounds.maxY - bounds.minY);
      const span = Math.max(spanX, spanY); // oranı koru
      const scale = (size - 24) / span;
      state.scale = scale;
      return {
        x: 12 + (point.x - bounds.minX) * scale + (span - spanX) * scale / 2,
        y: size - 12 - ((point.y - bounds.minY) * scale + (span - spanY) * scale / 2)
      };
    }

    function draw() {
      if (!ctx) {
        note.textContent = 'Radar çizimi bu ortamda desteklenmiyor (canvas yok).';
        return;
      }
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#101014';
      ctx.fillRect(0, 0, size, size);

      const points = state.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!points.length) {
        ctx.fillStyle = '#6f6f78';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(config.emptyText || 'Bu filtre için konum verisi yok', size / 2, size / 2);
        note.textContent = '';
        return;
      }

      // Izgara
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      ctx.lineWidth = 1;
      for (let index = 1; index < 6; index += 1) {
        const offset = (size / 6) * index;
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset, size);
        ctx.moveTo(0, offset);
        ctx.lineTo(size, offset);
        ctx.stroke();
      }

      for (const point of points) {
        const style = KIND_STYLE[point.kind] || { color: '#9aa0a6', radius: 5, label: point.kind || '?' };
        const projected = project(point);
        if (!projected) continue;
        const radius = style.radius;
        const selected = point.active;

        if (point.kind === 'smoke' || point.kind === 'molotov') {
          ctx.beginPath();
          ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `${style.color}${point.kind === 'smoke' ? '33' : '2b'}`;
          ctx.fill();
          ctx.lineWidth = selected ? 2 : 1;
          ctx.strokeStyle = point.team && TEAM_COLORS[point.team] ? TEAM_COLORS[point.team] : style.color;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = style.color;
          ctx.fill();
          if (selected) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
          }
        }

        if (selected) {
          ctx.beginPath();
          ctx.arc(projected.x, projected.y, radius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      note.textContent = `${points.length} nokta · koordinatlar demoparser world space (yaklaşık)`;
    }

    function renderLegend() {
      clear(legend);
      const kinds = [...new Set(state.points.map((point) => point.kind))];
      for (const kind of kinds) {
        const style = KIND_STYLE[kind] || { color: '#9aa0a6', label: kind };
        legend.appendChild(el('span', { class: 'radar-legend-item' }, [
          el('i', { class: 'radar-dot', style: { background: style.color } }),
          el('span', { text: style.label })
        ]));
      }
    }

    function update(points = []) {
      state.points = points;
      state.bounds = computeBounds(points);
      draw();
      renderLegend();
      return wrapper;
    }

    if (ctx && config.onSelect) {
      canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = size / (rect.width || size);
        const scaleY = size / (rect.height || size);
        const clickX = (event.clientX - rect.left) * scaleX;
        const clickY = (event.clientY - rect.top) * scaleY;
        let best = null;
        let bestDistance = 14;
        for (const point of state.points) {
          const projected = project(point);
          if (!projected) continue;
          const distance = Math.hypot(projected.x - clickX, projected.y - clickY);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = point;
          }
        }
        if (best) config.onSelect(best);
      });
    }

    update(config.points || []);
    wrapper.update = update;
    return wrapper;
  }

  root.MF.components = root.MF.components || {};
  Object.assign(root.MF.components, { radar, RADAR_KIND_STYLE: KIND_STYLE });
})(typeof globalThis !== 'undefined' ? globalThis : this);
