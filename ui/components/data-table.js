/*
 * Sıralanabilir veri tablosu.
 *
 * Tablo yalnızca veri/filtre değiştiğinde yeniden çizilir; animasyon
 * döngüsünde render edilmez.
 */
(function (root) {
  'use strict';
  const { el, clear } = root.MF.dom;

  function dataTable(config = {}) {
    const {
      columns = [],
      rowKey = (_row, index) => String(index),
      onSort = null,
      onRowClick = null,
      emptyText = 'Veri yok',
      rowClass = null,
      caption = ''
    } = config;
    void rowKey;

    const wrapper = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const head = el('thead');
    const body = el('tbody');
    table.append(head, body);
    wrapper.appendChild(table);
    if (caption) wrapper.appendChild(el('div', { class: 'table-caption', text: caption }));

    function renderHead() {
      clear(head);
      const row = el('tr');
      const sort = config.sort || null;
      for (const column of columns) {
        const isSorted = sort && sort.key === column.key;
        const button = el('button', {
          type: 'button',
          class: `th-button${isSorted ? ' sorted' : ''}${column.sortable === false ? ' static' : ''}`,
          title: column.title || column.label
        }, [
          el('span', { text: column.label }),
          isSorted ? el('span', { class: 'sort-arrow', text: sort.dir === 'asc' ? '▲' : '▼' }) : null
        ]);
        if (column.sortable !== false) {
          button.addEventListener('click', () => {
            const dir = isSorted && sort.dir === 'desc' ? 'asc' : 'desc';
            if (onSort) onSort({ key: column.key, dir });
          });
        }
        row.appendChild(el('th', { class: column.align === 'right' ? 'align-right' : column.align === 'center' ? 'align-center' : '' }, [button]));
      }
      head.appendChild(row);
    }

    function renderBody() {
      clear(body);
      const rows = config.rows || [];
      if (!rows.length) {
        const cell = el('td', { colspan: String(columns.length), class: 'table-empty', text: emptyText });
        body.appendChild(el('tr', {}, [cell]));
        return;
      }
      rows.forEach((row, index) => {
        const tr = el('tr', { class: rowClass ? rowClass(row, index) : '' });
        if (onRowClick) {
          tr.classList.add('clickable');
          tr.addEventListener('click', (event) => onRowClick(row, index, event));
        }
        for (const column of columns) {
          const value = column.value ? column.value(row, index) : row[column.key];
          const cell = el('td', {
            class: `${column.align === 'right' ? 'align-right' : column.align === 'center' ? 'align-center' : ''}${column.className ? ` ${column.className}` : ''}`
          });
          if (value instanceof Node) cell.appendChild(value);
          else cell.textContent = value === null || value === undefined ? '—' : String(value);
          tr.appendChild(cell);
        }
        body.appendChild(tr);
      });
    }

    renderHead();
    renderBody();

    wrapper.update = (nextRows, nextSort) => {
      if (nextRows) config.rows = nextRows;
      if (nextSort !== undefined) config.sort = nextSort;
      renderHead();
      renderBody();
    };

    return wrapper;
  }

  root.MF.components = root.MF.components || {};
  root.MF.components.dataTable = dataTable;
})(typeof globalThis !== 'undefined' ? globalThis : this);
