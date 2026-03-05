'use client';

import React, { useEffect, useMemo, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable, type ColumnDef } from "@/app/components/clientTable/useClientTable";

// Utility für Token-Extraktion
function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || "";
}

type User = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: string | number;
};

export default function UsersOverview() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch("/api/users", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Fehler beim Laden");
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
    }
    load();
  }, [session]);

  async function sendInfoMail(u: User) {
    if (!u?.id) return;
    setActionMsg(null);
    setActionError(null);
    setSendingId(u.id);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/mails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recipients: { type: "user", ids: [u.id] } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data?.error || `Fehler ${res.status}`);
        return;
      }
      setActionMsg(`Infomail an ${u.first_name} ${u.last_name} (${u.mail}) versendet (${data.success}/${data.total} erfolgreich).`);
    } catch (e: any) {
      setActionError(e?.message || "Fehler beim Senden");
    } finally {
      setSendingId(null);
    }
  }

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      { id: 'first_name', header: 'Vorname', type: 'text', accessor: (u) => u.first_name },
      { id: 'last_name', header: 'Nachname', type: 'text', accessor: (u) => u.last_name },
      { id: 'mail', header: 'Mailadresse', type: 'text', accessor: (u) => u.mail },
      {
        id: 'balance',
        header: 'Kontostand',
        type: 'number',
        accessor: (u) => (typeof u.balance === 'string' ? Number(u.balance) : Number(u.balance)),
        cell: (u) => (typeof u.balance === "string" ? u.balance : Number(u.balance).toLocaleString("de-DE", { style: "currency", currency: "EUR" })),
      },
      {
        id: 'infoMail',
        header: 'Infomail',
        accessor: (u) => u.id,
        sortable: false,
        filterable: false,
        cell: (u) => (
          <button className="button" onClick={() => sendInfoMail(u)} disabled={sendingId === u.id}>
            {sendingId === u.id ? 'Senden…' : 'Infomail'}
          </button>
        ),
      },
      {
        id: 'details',
        header: 'Details',
        accessor: (u) => u.id,
        sortable: false,
        filterable: false,
        cell: (u) => (
          <button className="button" onClick={() => window.location.href = `/users/${u.id}`}>
            Details
          </button>
        ),
      },
      {
        id: 'edit',
        header: 'Bearbeiten',
        accessor: (u) => u.id,
        sortable: false,
        filterable: false,
        cell: (u) => (
          <button className="button" onClick={() => window.location.href = `/users/${u.id}/edit`}>
            Bearbeiten
          </button>
        ),
      },
    ],
    [sendingId]
  );

  const table = useClientTable(users, columns, { enableFilters: true });

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Nutzerübersicht</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      {actionMsg && <div className="message kc-preline u-mb-2">{actionMsg}</div>}
      {actionError && <div className="message kc-message--error u-mb-2">{actionError}</div>}
      <table className="kc-table" role="table">
        <ClientTableHead table={table} />
        <tbody>
          {table.filteredSortedRows.map(u => (
            <tr key={u.id} className="kc-row">
              {table.columns.map((c) => (
                <td key={c.id}>{c.cell ? c.cell(u) : String(c.accessor(u) ?? '-') || '-'}</td>
              ))}
            </tr>
          ))}
          {table.filteredSortedRows.length === 0 && !loading && (
            <tr><td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">Keine Nutzer gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
