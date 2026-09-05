/*
 * Ortak filtre bileşenleri: oyuncu, round, silah, taraf.
 * Tümü MF.filters üzerindeki paylaşılan durumu kullanır.
 */
(function (root) {
  'use strict';
  const { el } = root.MF.dom;
  const filters = root.MF.filters;

  function selectField({ label, options, value, onChange, id }) {
    const select = el('select', { class: 'filter-select', id: id || undefined, 'aria-label': label },
      options.map((option) => el('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label)));
    select.value = String(value);
    select.addEventListener('change', () => onChange(select.value));
    return el('label', { class: 'filter-field' }, [
      el('span', { class: 'filter-label', text: label }),
      select
    ]);
  }

  function playerFilter(model, options = {}) {
    const { includeAll = true, onChange } = options;
    const current = filters.get();
    const list = (model?.playerOrder || [])
      .map((steamId) => model.players[steamId])
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'));

    const optionsList = [
      ...(includeAll ? [{ value: '', label: 'Tüm oyuncular' }] : []),
      ...list.map((player) => ({
        value: player.steamId,
        label: `${player.name || player.steamId}${player.teamName ? ` · ${player.teamName}` : ''}`
      }))
    ];

    return selectField({
      label: 'Oyuncu',
      id: 'globalPlayerFilter',
      options: optionsList,
      value: current.playerSteamId || '',
      onChange: (value) => {
        filters.set({ playerSteamId: value });
        if (onChange) onChange(value);
      }
    });
  }

  function roundFilter(model, options = {}) {
    const { onChange } = options;
    const current = filters.get();
    const rounds = model?.rounds || [];
    const list = [
      { value: 'all', label: 'Tümü' },
      ...rounds.map((round) => ({ value: String(round.number), label: `Round ${round.number}` }))
    ];
    return selectField({
      label: 'Round',
      id: 'globalRoundFilter',
      options: list,
      value: String(current.round),
      onChange: (value) => {
        filters.set({ round: value === 'all' ? 'all' : Number(value) });
        if (onChange) onChange(value);
      }
    });
  }

  function weaponFilter(weaponKeys, options = {}) {
    const { onChange } = options;
    const current = filters.get();
    const list = [
      { value: 'all', label: 'Tümü' },
      ...weaponKeys.map((entry) => ({ value: entry.key, label: entry.label }))
    ];
    return selectField({
      label: 'Silah',
      id: 'globalWeaponFilter',
      options: list,
      value: current.weapon,
      onChange: (value) => {
        filters.set({ weapon: value });
        if (onChange) onChange(value);
      }
    });
  }

  function sideFilter(options = {}) {
    const { onChange } = options;
    const current = filters.get();
    return selectField({
      label: 'Taraf',
      id: 'globalSideFilter',
      options: [
        { value: 'all', label: 'Tümü' },
        { value: 'T', label: 'T' },
        { value: 'CT', label: 'CT' }
      ],
      value: current.side,
      onChange: (value) => {
        filters.set({ side: value });
        if (onChange) onChange(value);
      }
    });
  }

  function toolbar(children, extraClass = '') {
    return el('div', { class: `view-toolbar${extraClass ? ` ${extraClass}` : ''}` }, children);
  }

  root.MF.components = root.MF.components || {};
  Object.assign(root.MF.components, { selectField, playerFilter, roundFilter, weaponFilter, sideFilter, toolbar });
})(typeof globalThis !== 'undefined' ? globalThis : this);
