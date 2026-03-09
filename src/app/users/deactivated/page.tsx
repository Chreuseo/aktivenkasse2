'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/css/tables.css';
import { useSession } from 'next-auth/react';

import { extractToken } from '@/lib/utils';
import { ClientTableHead } from '@/app/components/clientTable/ClientTableHead';
import { useClientTable, type ColumnDef } from '@/app/components/clientTable/useClientTable';

type DeactivatedUser = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
};

export default function DeactivatedUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<DeactivatedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch('/api/users/deactivated', {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || 'Fehler beim Laden');
        setUsers([]);
      } else {
        setUsers(json);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = useCallback(
    async (id: number) => {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch('/api/users/deactivated', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error || 'Fehler beim Aktivieren');
        } else {
          await load();
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    [session, load]
  );

  const columns = useMemo<ColumnDef<DeactivatedUser>[]>(
    () => [
      { id: 'first_name', header: 'Vorname', type: 'text', accessor: (u) => u.first_name },
      { id: 'last_name', header: 'Nachname', type: 'text', accessor: (u) => u.last_name },
      { id: 'mail', header: 'Mailadresse', type: 'text', accessor: (u) => u.mail },
      {
        id: 'details',
        header: 'Details',
        accessor: (u) => u.id,
        sortable: false,
        filterable: false,
        cell: (u) => (
          <button className="button" onClick={() => (window.location.href = `/users/${u.id}`)}>
            Details
          </button>
        ),
      },
      {
        id: 'activate',
        header: 'Aktivieren',
        accessor: (u) => u.id,
        sortable: false,
        filterable: false,
        cell: (u) => (
          <button className="button" onClick={() => activate(u.id)} disabled={loading}>
            Aktivieren
          </button>
        ),
      },
    ],
    [activate, loading]
  );

  const table = useClientTable(users, columns, { enableFilters: true });

  return (
    <div className="kc-page kc-table">
      <h2 className="kc-page-title">Deaktivierte Nutzer</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      <table className="kc-table" role="table">
        <ClientTableHead table={table} />
        <tbody>
          {table.filteredSortedRows.map((u) => (
            <tr key={u.id} className="kc-row">
              {table.columns.map((c) => (
                <td key={c.id}>{c.cell ? c.cell(u) : String(c.accessor(u) ?? '-') || '-'}</td>
              ))}
            </tr>
          ))}
          {table.filteredSortedRows.length === 0 && !loading && (
            <tr>
              <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">
                Keine deaktivierten Nutzer gefunden
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
