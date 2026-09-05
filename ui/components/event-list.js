/*
 * Satır listesi bileşeni (round listesi, duel listesi, utility eventleri).
 * Her satır opsiyonel bir "Replay'e git" aksiyonu taşıyabilir.
 */
(function (root) {
  'use strict';
  const { el, clear } = root.MF.dom;

  function eventList(config = {}) {
    const {
      rows = [],
      renderRow,
      emptyText = 'Kayıt yok',
      onRowClick = null,
      maxRows = 0
    } = config;

    const list = el('div', { class: 'event-list' });

    function render() {
      clear(list);
      const source = maxRows > 0 ? rows.slice(0, maxRows) : rows;
      if (!source.length) {
        list.appendChild(el('div', { class: 'event-empty', text: emptyText }));
        return;
      }
      source.forEach((row, index) => {
        const node = renderRow(row, index);
        if (!node) return;
        if (onRowClick) {
          node.classList.add('clickable');
          node.addEventListener('click', (event) => onRowClick(row, index, event));
        }
        list.appendChild(node);
      });
    }

    render();
    list.update = (nextRows) => {
      config.rows = nextRows;
      render();
    };
    return list;
  }

  function eventRow({ title, meta = [], badges = [], action = null, tone = '' }) {
    return el('div', { class: `event-row${tone ? ` tone-${tone}` : ''}` }, [
      el('div', { class: 'event-main' }, [
        el('span', { class: 'event-title', text: title }),
        meta.length
          ? el('span', { class: 'event-meta' }, meta.filter(Boolean).map((item) => el('span', { class: 'event-meta-item', text: item })))
          : null
      ]),
      badges.length ? el('div', { class: 'event-badges' }, badges.filter(Boolean).map((badge) => (
        typeof badge === 'string'
          ? el('span', { class: 'badge', text: badge })
          : el('span', { class: `badge${badge.tone ? ` badge-${badge.tone}` : ''}`, text: badge.text, title: badge.title || '' })
      ))) : null,
      action ? el('div', { class: 'event-action' }, [action]) : null
    ]);
  }

  root.MF.components = root.MF.components || {};
  Object.assign(root.MF.components, { eventList, eventRow });
})(typeof globalThis !== 'undefined' ? globalThis : this);
