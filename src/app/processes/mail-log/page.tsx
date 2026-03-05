'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import '@/app/css/tables.css';
import { ClientTableHead } from '@/app/components/clientTable/ClientTableHead';
import { useClientTable, type ColumnDef } from '@/app/components/clientTable/useClientTable';

function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || '';
}

type MailListItem = {
  id: number;
  subject: string;
  sentAt: string;
  user: { id: number; first_name: string; last_name: string } | null;
};

export default function MailLogPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch('/api/mails', {
          method: 'GET',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || 'Fehler beim Laden');
          setItems([]);
        } else {
          setItems(json);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  const columns = useMemo<ColumnDef<MailListItem>[]>(
    () => [
      {
        id: 'sentAt',
        header: 'Datum',
        type: 'date',
        accessor: (m) => m.sentAt,
        cell: (m) => (m.sentAt ? new Date(m.sentAt).toLocaleString('de-DE') : ''),
      },
      {
        id: 'subject',
        header: 'Betreff',
        type: 'text',
        accessor: (m) => m.subject,
      },
      {
        id: 'user',
        header: 'Nutzer',
        type: 'text',
        accessor: (m) => (m.user ? `${m.user.first_name} ${m.user.last_name}` : ''),
        cell: (m) => (m.user ? `${m.user.first_name} ${m.user.last_name}` : '—'),
      },
      {
        id: 'open',
        header: 'Öffnen',
        accessor: (m) => m.id,
        filterable: false,
        sortable: false,
        cell: (m) => (
          <button className="button" onClick={() => (window.location.href = `/processes/mail-log/${m.id}`)}>
            Öffnen
          </button>
        ),
      },
    ],
    []
  );

  const table = useClientTable(items, columns, { enableFilters: true });

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Mail-Log</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      <table className="kc-table" role="table">
        <ClientTableHead table={table} />
        <tbody>
          {table.filteredSortedRows.map((m) => (
            <tr key={m.id} className="kc-row">
              {table.columns.map((c) => (
                <td key={c.id}>{c.cell ? c.cell(m) : String(c.accessor(m) ?? '-') || '-'}</td>
              ))}
            </tr>
          ))}
          {table.filteredSortedRows.length === 0 && !loading && (
            <tr>
              <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">
                Keine Mails gefunden
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
