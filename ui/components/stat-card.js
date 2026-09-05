/*
 * Özet kartı bileşeni.
 */
(function (root) {
  'use strict';
  const { el } = root.MF.dom;

  function statCard(config = {}) {
    const { label, value = '—', hint = '', tone = '' } = config;
    return el('div', { class: `stat-card${tone ? ` tone-${tone}` : ''}` }, [
      el('span', { class: 'stat-label', text: label }),
      el('strong', { class: 'stat-value', text: String(value) }),
      hint ? el('span', { class: 'stat-hint', text: hint }) : null
    ]);
  }

  function statGrid(cards, className = '') {
    return el('div', { class: `stat-grid${className ? ` ${className}` : ''}` }, cards);
  }

  root.MF.components = root.MF.components || {};
  root.MF.components.statCard = statCard;
  root.MF.components.statGrid = statGrid;
})(typeof globalThis !== 'undefined' ? globalThis : this);
