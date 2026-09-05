/*
 * Üç durumlu boş ekran bileşeni:
 *   1) demo yok         → "Analiz için bir demo yükle"
 *   2) veri yok         → "Bu demo bu metriği sağlamıyor"
 *   3) hazır            → ekran kendi içeriğini çizer
 */
(function (root) {
  'use strict';
  const { el } = root.MF.dom;

  function emptyState(config = {}) {
    const {
      title = 'Veri yok',
      message = '',
      kind = 'no-data', // no-demo | no-data | error
      actionLabel = '',
      onAction = null,
      details = []
    } = config;

    const node = el('div', { class: `empty-panel kind-${kind}` }, [
      el('div', { class: 'empty-mark', text: kind === 'no-demo' ? 'MF' : '—' }),
      el('strong', { class: 'empty-title', text: title }),
      message ? el('span', { class: 'empty-message', text: message }) : null,
      details.length
        ? el('ul', { class: 'empty-details' }, details.map((item) => el('li', { text: item })))
        : null,
      actionLabel && onAction
        ? el('button', { type: 'button', class: 'btn secondary empty-action', text: actionLabel, onclick: onAction })
        : null
    ]);
    return node;
  }

  function noDemo(message = 'Analiz için bir demo yükle.', onOpen) {
    return emptyState({
      kind: 'no-demo',
      title: 'Demo bekleniyor',
      message,
      actionLabel: onOpen ? 'Demo Aç' : '',
      onAction: onOpen || null
    });
  }

  function noDataset(message, details = []) {
    return emptyState({
      kind: 'no-data',
      title: 'Bu demo bu metriği sağlamıyor',
      message,
      details
    });
  }

  root.MF.components = root.MF.components || {};
  root.MF.components.emptyState = emptyState;
  root.MF.components.noDemo = noDemo;
  root.MF.components.noDataset = noDataset;
})(typeof globalThis !== 'undefined' ? globalThis : this);
