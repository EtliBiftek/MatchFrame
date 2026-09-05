/*
 * MatchFrame — küçük DOM ve biçimlendirme yardımcıları.
 * Framework eklemeden modüler UI kurmak için yeterli kadar.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  const ns = (root.MF = root.MF || {});
  ns.dom = Object.assign(ns.dom || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) {
    while (node?.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  function formatValue(value, fallback = '—') {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return fallback;
    return String(value);
  }

  function formatPercentValue(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(0)}%`;
  }

  return { el, clear, formatNumber, formatClock, formatValue, formatPercentValue };
});
