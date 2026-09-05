/*
 * Koçluk notu bileşeni (Aşama 7.2).
 *
 * Ruby motorundan gelen notları kategoriye göre ilgili ekranda gösterir:
 *   Analysis → tüm kategoriler · Aim → aim · Utility → utility
 *
 * Üç durum:
 *   1) yükleniyor        → "Koçluk notları hesaplanıyor…"
 *   2) motor yok / hata  → emptyState('warn' | 'error') + sebep (ekran çalışmaya devam eder)
 *   3) notlar hazır      → önem sırasına göre liste (high → medium → low)
 *
 * Not yoksa uydurma öneri üretilmez: kaç kuralın değerlendirildiği ve kaçının
 * veri eksikliği nedeniyle atlandığı açıkça yazılır.
 */
(function (root) {
  'use strict';
  const { el, clear } = root.MF.dom;
  const components = root.MF.components;

  const slots = new Set();

  function coaching() {
    return root.MF?.analysis?.coaching || null;
  }

  function categoryLabel(category) {
    return coaching()?.CATEGORY_LABELS?.[category] || category;
  }

  function severityLabel(severity) {
    return coaching()?.SEVERITY_LABELS?.[severity] || severity;
  }

  function noteRow(note) {
    return el('li', { class: `coach-note severity-${note.severity}` }, [
      el('span', { class: 'coach-note-head' }, [
        el('span', { class: 'coach-severity', text: severityLabel(note.severity) }),
        el('span', { class: 'coach-category', text: categoryLabel(note.category) }),
        el('strong', { class: 'coach-tag', text: note.tag })
      ]),
      el('p', { class: 'coach-text', text: note.text }),
      note.metric ? el('span', { class: 'coach-metric', text: `metrik: ${note.metric}` }) : null
    ]);
  }

  function statusLine(state) {
    const parts = [];
    if (state.engine) parts.push(`motor: ${state.engine}`);
    if (Number.isFinite(state.evaluated)) parts.push(`${state.evaluated} kural değerlendirildi`);
    if (Array.isArray(state.skipped) && state.skipped.length) {
      parts.push(`${state.skipped.length} kural veri eksikliği nedeniyle atlandı`);
    }
    return parts.length ? el('span', { class: 'coach-meta', text: parts.join(' · ') }) : null;
  }

  function renderSlot(entry) {
    clear(entry.node);
    const api = coaching();
    if (!api) {
      entry.node.appendChild(components.emptyState({
        kind: 'warn',
        title: 'Koçluk modülü yüklenmedi',
        message: 'analysis/coaching.js bulunamadı.'
      }));
      return;
    }
    const state = api.getState();

    if (state.status === 'idle' || state.status === 'loading') {
      entry.node.appendChild(el('div', { class: 'coach-status' }, [
        el('span', { class: 'coach-spinner' }),
        el('span', { text: 'Koçluk notları hesaplanıyor…' })
      ]));
      return;
    }

    if (state.status === 'error' || state.status === 'unavailable') {
      entry.node.appendChild(components.emptyState({
        kind: state.status === 'error' ? 'error' : 'warn',
        title: 'Koçluk notları alınamadı',
        message: state.message || 'Ruby koçluk motoru bu ortamda etkin değil.',
        details: [
          'Ruby kurulu değilse veya motor hata verirse ekranlar çalışmaya devam eder.',
          'Metrikler yalnızca ölçülen veriden üretilir; eksik veri için öneri uydurulmaz.'
        ],
        actionLabel: 'Yeniden dene',
        onAction: () => api.refresh()
      }));
      return;
    }

    const all = state.notes || [];
    const visible = entry.categories.length
      ? all.filter((note) => entry.categories.includes(note.category))
      : all.slice();

    if (!visible.length) {
      const otherCount = all.length;
      entry.node.appendChild(el('div', { class: 'coach-empty' }, [
        el('p', {
          class: 'coach-empty-text',
          text: otherCount
            ? `Bu ekran için not yok. ${otherCount} not diğer ekranlarda (${[...new Set(all.map((note) => categoryLabel(note.category)))].join(', ')}) gösteriliyor.`
            : 'Bu maç için kural tetiklenmedi — ölçülen metrikler hedeflerin içinde.'
        }),
        statusLine(state)
      ]));
      return;
    }

    entry.node.appendChild(el('ul', { class: 'coach-list' }, visible.map(noteRow)));
    const meta = statusLine(state);
    if (meta) entry.node.appendChild(meta);
  }

  function purge() {
    for (const entry of [...slots]) {
      if (!entry.node.isConnected) slots.delete(entry);
    }
  }

  function refreshAll() {
    purge();
    for (const entry of slots) {
      try {
        renderSlot(entry);
      } catch (error) {
        root.console?.error?.('[MF coach] notlar çizilemedi', error);
      }
    }
  }

  /*
   * categories: null → tümü · ['aim'] → yalnızca aim kategorisi
   * Dönen düğüm koçluk durumu değiştikçe kendini yeniler.
   */
  function coachNotes(options = {}) {
    const { categories = null } = options;
    const node = el('div', { class: 'coach-panel' });
    const entry = { node, categories: Array.isArray(categories) ? categories.slice() : [] };
    slots.add(entry);
    renderSlot(entry);
    return node;
  }

  function coachSection(options = {}) {
    const { categories = null, title = 'Koçluk notları', note = '' } = options;
    const api = coaching();
    const actions = el('div', { class: 'block-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn secondary mini',
        text: 'Yenile',
        title: 'Koçluk motorunu yeniden çalıştır',
        onclick: () => api?.refresh()
      })
    ]);
    return el('section', { class: 'block' }, [
      el('header', { class: 'block-head' }, [
        el('h2', { class: 'block-title', text: title }),
        actions
      ]),
      el('div', { class: 'block-body' }, [
        note ? el('p', { class: 'block-note', text: note }) : null,
        coachNotes({ categories })
      ])
    ]);
  }

  root.MF.components = root.MF.components || {};
  Object.assign(root.MF.components, { coachNotes, coachSection, coachRefreshAll: refreshAll });

  // Koçluk durumu değiştiğinde (loading → ok/unavailable/error) tüm paneller yenilenir.
  const api = root.MF?.analysis?.coaching;
  if (api && typeof api.subscribe === 'function') api.subscribe(refreshAll);

  const bus = root.MF.bus;
  if (bus && typeof bus.on === 'function') {
    bus.on('demo:changed', () => {
      coaching()?.reset();
      refreshAll();
    });
    bus.on('demo:cleared', () => {
      coaching()?.reset();
      refreshAll();
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
