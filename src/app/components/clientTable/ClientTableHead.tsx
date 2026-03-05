'use client';

import * as React from 'react';
import type { ColumnFilterValue, SortDirection, UseClientTableResult } from './useClientTable';

function sortIcon(sortDir: SortDirection | null) {
  if (sortDir === 'asc') return '▲';
  if (sortDir === 'desc') return '▼';
  return '↕';
}

function ariaSort(sortDir: SortDirection | null): React.AriaAttributes['aria-sort'] {
  if (sortDir === 'asc') return 'ascending';
  if (sortDir === 'desc') return 'descending';
  return 'none';
}

export function ClientTableHead<T>({
  table,
  className,
}: {
  table: UseClientTableResult<T>;
  className?: string;
}) {
  const { columns, sort, toggleSort, enableFilters, filters, setFilter, clearFilters } = table;
  const [showFilters, setShowFilters] = React.useState(false);

  // Wenn Filter ausgeblendet werden, räumen wir den Filter-State auf.
  React.useEffect(() => {
    if (!showFilters) clearFilters();
  }, [showFilters, clearFilters]);

  return (
    <thead className={className}>
      <tr>
        {columns.map((c, idx) => {
          const current = sort.columnId === c.id ? sort.direction : null;
          const sortable = c.sortable !== false;
          return (
            <th key={c.id} aria-sort={sortable ? ariaSort(current) : undefined}>
              <div className="kc-th-wrap">
                {idx === 0 && enableFilters && (
                  <label className="kc-filter-toggle" title="Filter anzeigen">
                    <input
                      type="checkbox"
                      checked={showFilters}
                      onChange={(e) => setShowFilters(e.target.checked)}
                      aria-label="Filter anzeigen"
                    />Filter
                  </label>
                )}

                {sortable ? (
                  <button
                    type="button"
                    className="kc-th-sort"
                    onClick={() => toggleSort(c.id)}
                    aria-label={`Sortieren nach ${String(c.header)}`}
                  >
                    <span className="kc-th-sort__label">{c.header}</span>
                    <span className="kc-th-sort__icon" aria-hidden="true">
                      {sortIcon(current)}
                    </span>
                  </button>
                ) : (
                  c.header
                )}
              </div>
            </th>
          );
        })}
      </tr>

      {enableFilters && showFilters && (
        <tr className="kc-filter-row">
          {columns.map((c) => {
            const filterable = c.filterable !== false;
            if (!filterable) return <th key={c.id} />;

            const type = c.type ?? 'text';
            const f = filters[c.id];

            if (type === 'number') {
              const fv: ColumnFilterValue =
                f?.kind === 'number' ? f : { kind: 'number', op: 'eq', value: '' };
              return (
                <th key={c.id}>
                  <div className="kc-filter-cell">
                    <select
                      className="kc-select kc-select--sm"
                      value={fv.op}
                      onChange={(e) =>
                        setFilter(c.id, { kind: 'number', op: e.target.value as any, value: fv.value })
                      }
                      aria-label={`Operator für ${String(c.header)}`}
                    >
                      <option value="eq">=</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">≤</option>
                      <option value="gt">&gt;</option>
                      <option value="gte">≥</option>
                    </select>
                    <input
                      className="kc-input kc-input--sm"
                      type="number"
                      value={fv.value}
                      onChange={(e) =>
                        setFilter(c.id, {
                          kind: 'number',
                          op: fv.op,
                          value: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                      placeholder={c.filterPlaceholder ?? 'Zahl…'}
                      aria-label={`Filter für ${String(c.header)}`}
                    />
                  </div>
                </th>
              );
            }

            if (type === 'date') {
              const fv: ColumnFilterValue = f?.kind === 'date' ? f : { kind: 'date', op: 'eq', value: '' };
              return (
                <th key={c.id}>
                  <div className="kc-filter-cell">
                    <select
                      className="kc-select kc-select--sm"
                      value={fv.op}
                      onChange={(e) => setFilter(c.id, { kind: 'date', op: e.target.value as any, value: fv.value })}
                      aria-label={`Operator für ${String(c.header)}`}
                    >
                      <option value="eq">=</option>
                      <option value="before">vor</option>
                      <option value="after">nach</option>
                    </select>
                    <input
                      className="kc-input kc-input--sm"
                      type="date"
                      value={fv.value}
                      onChange={(e) => setFilter(c.id, { kind: 'date', op: fv.op, value: e.target.value })}
                      aria-label={`Filter für ${String(c.header)}`}
                    />
                  </div>
                </th>
              );
            }

            if (type === 'boolean') {
              const fv: ColumnFilterValue = f?.kind === 'boolean' ? f : { kind: 'boolean', value: 'all' };
              return (
                <th key={c.id}>
                  <select
                    className="kc-select kc-select--sm"
                    value={fv.value}
                    onChange={(e) => setFilter(c.id, { kind: 'boolean', value: e.target.value as any })}
                    aria-label={`Filter für ${String(c.header)}`}
                  >
                    <option value="all">Alle</option>
                    <option value="true">Ja</option>
                    <option value="false">Nein</option>
                  </select>
                </th>
              );
            }

            // text default
            const text = f?.kind === 'text' ? f.value : '';
            return (
              <th key={c.id}>
                <input
                  className="kc-input kc-input--sm"
                  type="text"
                  value={text}
                  onChange={(e) => setFilter(c.id, { kind: 'text', value: e.target.value })}
                  placeholder={c.filterPlaceholder ?? 'Suchen…'}
                  aria-label={`Filter für ${String(c.header)}`}
                />
              </th>
            );
          })}
        </tr>
      )}
    </thead>
  );
}
