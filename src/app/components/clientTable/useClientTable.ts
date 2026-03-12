'use client';

import * as React from 'react';

export type SortDirection = 'asc' | 'desc';

export type ColumnType = 'text' | 'number' | 'date' | 'boolean';

export type ColumnFilterValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'; value: number | '' }
  | { kind: 'date'; op: 'eq' | 'before' | 'after'; value: string } // yyyy-mm-dd
  | { kind: 'boolean'; value: 'all' | 'true' | 'false' };

export interface ColumnDef<T> {
  id: string;
  header: React.ReactNode;
  type?: ColumnType;
  /** Value used for sorting + filtering. Keep it primitive-ish (string/number/boolean/Date/undefined). */
  accessor: (row: T) => unknown;
  /** Optional cell renderer (falls back to stringified accessor). */
  cell?: (row: T) => React.ReactNode;
  /** Enable/disable sorting per column (default: true). */
  sortable?: boolean;
  /** Enable/disable filtering per column (default: true). */
  filterable?: boolean;
  /** Custom comparator (overrides type-based compare) */
  sortFn?: (a: T, b: T) => number;
  /** Custom filter predicate (overrides type-based filter) */
  filterFn?: (row: T, filterValue: ColumnFilterValue) => boolean;
  /** Optional placeholder for text filter */
  filterPlaceholder?: string;
}

export interface UseClientTableOptions {
  /** When true, renders a filter row under headers in the provided UI helper. */
  enableFilters?: boolean;
  /** Default sorting applied when the table mounts. */
  initialSort?: { columnId: string; direction?: SortDirection };
}

export interface UseClientTableResult<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  filteredSortedRows: T[];
  sort: { columnId: string | null; direction: SortDirection };
  setSort: React.Dispatch<React.SetStateAction<{ columnId: string | null; direction: SortDirection }>>;
  toggleSort: (columnId: string) => void;
  filters: Record<string, ColumnFilterValue | undefined>;
  setFilter: (columnId: string, value: ColumnFilterValue | undefined) => void;
  clearFilters: () => void;
  enableFilters: boolean;
}

function isNil(v: unknown) {
  return v === null || v === undefined;
}

function asNumber(v: unknown): number | null {
  if (isNil(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replaceAll('.', '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asDateMs(v: unknown): number | null {
  if (isNil(v)) return null;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function compareUnknown(a: unknown, b: unknown, type: ColumnType): number {
  // Consistent null placement: null/undefined always last (asc) / first (desc handled outside)
  const aNil = isNil(a);
  const bNil = isNil(b);
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;

  switch (type) {
    case 'number': {
      const an = asNumber(a);
      const bn = asNumber(b);
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return an - bn;
    }
    case 'date': {
      const ad = asDateMs(a);
      const bd = asDateMs(b);
      if (ad === null && bd === null) return 0;
      if (ad === null) return 1;
      if (bd === null) return -1;
      return ad - bd;
    }
    case 'boolean': {
      const ab = Boolean(a);
      const bb = Boolean(b);
      return Number(ab) - Number(bb);
    }
    case 'text':
    default: {
      return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
    }
  }
}

function defaultFilterPredicate(value: unknown, filterValue: ColumnFilterValue, type: ColumnType): boolean {
  if (filterValue.kind === 'text') {
    const q = filterValue.value.trim().toLowerCase();
    if (!q) return true;
    if (isNil(value)) return false;
    return String(value).toLowerCase().includes(q);
  }

  if (filterValue.kind === 'boolean') {
    if (filterValue.value === 'all') return true;
    const want = filterValue.value === 'true';
    return Boolean(value) === want;
  }

  if (filterValue.kind === 'number') {
    if (filterValue.value === '') return true;
    const n = asNumber(value);
    if (n === null) return false;
    const target = Number(filterValue.value);
    switch (filterValue.op) {
      case 'eq':
        return n === target;
      case 'lt':
        return n < target;
      case 'lte':
        return n <= target;
      case 'gt':
        return n > target;
      case 'gte':
        return n >= target;
    }
  }

  if (filterValue.kind === 'date') {
    const q = filterValue.value;
    if (!q) return true;
    const ms = asDateMs(value);
    if (ms === null) return false;
    const qMs = asDateMs(q);
    if (qMs === null) return false;

    // Compare as date-only (strip time)
    const d = new Date(ms);
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const qd = new Date(qMs);
    const q0 = new Date(qd.getFullYear(), qd.getMonth(), qd.getDate()).getTime();

    switch (filterValue.op) {
      case 'eq':
        return d0 === q0;
      case 'before':
        return d0 < q0;
      case 'after':
        return d0 > q0;
    }
  }

  // fallback
  return defaultFilterPredicate(value, { kind: 'text', value: String((filterValue as any)?.value ?? '') }, type);
}

export function useClientTable<T>(
  rows: T[],
  columns: ColumnDef<T>[],
  options: UseClientTableOptions = {}
): UseClientTableResult<T> {
  const enableFilters = options.enableFilters ?? true;

  const [sort, setSort] = React.useState<{ columnId: string | null; direction: SortDirection }>(() => {
    const initial = options.initialSort;
    if (!initial?.columnId) return { columnId: null, direction: 'asc' };
    return { columnId: initial.columnId, direction: initial.direction ?? 'asc' };
  });

  const [filters, setFilters] = React.useState<Record<string, ColumnFilterValue | undefined>>({});

  const toggleSort = React.useCallback((columnId: string) => {
    setSort((prev) => {
      if (prev.columnId !== columnId) return { columnId, direction: 'asc' };
      // asc -> desc -> none
      if (prev.direction === 'asc') return { columnId, direction: 'desc' };
      return { columnId: null, direction: 'asc' };
    });
  }, []);

  const setFilter = React.useCallback((columnId: string, value: ColumnFilterValue | undefined) => {
    setFilters((prev) => {
      const next = { ...prev, [columnId]: value };
      // Keep object small
      if (!value) delete next[columnId];
      // Remove empty text filters
      if (value?.kind === 'text' && !value.value.trim()) delete next[columnId];
      if (value?.kind === 'date' && !value.value) delete next[columnId];
      if (value?.kind === 'number' && value.value === '') delete next[columnId];
      if (value?.kind === 'boolean' && value.value === 'all') delete next[columnId];
      return next;
    });
  }, []);

  const clearFilters = React.useCallback(() => setFilters({}), []);

  const filteredSortedRows = React.useMemo(() => {
    let out = rows;

    // filtering
    const activeFilters = Object.entries(filters).filter(([, v]) => v !== undefined);
    if (enableFilters && activeFilters.length > 0) {
      out = out.filter((row) => {
        for (const [colId, f] of activeFilters) {
          const col = columns.find((c) => c.id === colId);
          if (!col || col.filterable === false || !f) continue;
          const type = col.type ?? 'text';
          const raw = col.accessor(row);
          const ok = col.filterFn ? col.filterFn(row, f) : defaultFilterPredicate(raw, f, type);
          if (!ok) return false;
        }
        return true;
      });
    }

    // sorting
    if (sort.columnId) {
      const col = columns.find((c) => c.id === sort.columnId);
      if (col && col.sortable !== false) {
        const type = col.type ?? 'text';
        const dir = sort.direction;
        const factor = dir === 'asc' ? 1 : -1;
        const cmp = col.sortFn
          ? (a: T, b: T) => col.sortFn!(a, b)
          : (a: T, b: T) => compareUnknown(col.accessor(a), col.accessor(b), type);
        out = [...out].sort((a, b) => factor * cmp(a, b));
      }
    }

    return out;
  }, [rows, columns, filters, sort.columnId, sort.direction, enableFilters]);

  return {
    columns,
    rows,
    filteredSortedRows,
    sort,
    setSort,
    toggleSort,
    filters,
    setFilter,
    clearFilters,
    enableFilters,
  };
}

