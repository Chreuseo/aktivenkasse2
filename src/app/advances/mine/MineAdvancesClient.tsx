"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";
import "../../css/tables.css";

import type { AdvanceListItem, AdvanceState } from "@/app/types/advance";
import { advanceStateLabel } from "@/app/types/advance";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable, type ColumnDef } from "@/app/components/clientTable/useClientTable";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Unbekannter Fehler";
}

export default function MineAdvancesClient() {
  const { data: session } = useSession();
  const [items, setItems] = useState<AdvanceListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/advances/mine", {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Unbekannter Fehler");
        return;
      }
      setItems(json.items as AdvanceListItem[]);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const cancelAdvance = useCallback(async (id: number) => {
    if (!confirm("Auslage wirklich abbrechen?")) return;
    setWorkingId(id);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/advances", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Unbekannter Fehler");
        return;
      }
      // Refresh list
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setWorkingId(null);
    }
  }, [session, load]);

  const fmtAmount = (v: string | number) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (!isFinite(n)) return String(v);
    try {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };

  const columns = useMemo<ColumnDef<AdvanceListItem>[]>(
    () => [
      {
        id: 'date_advance',
        header: 'Datum',
        type: 'date',
        accessor: (it) => it.date_advance,
        cell: (it) => new Date(it.date_advance).toLocaleDateString("de-DE"),
      },
      {
        id: 'description',
        header: 'Beschreibung',
        type: 'text',
        accessor: (it) => it.description,
      },
      {
        id: 'amount',
        header: 'Betrag',
        type: 'number',
        accessor: (it) => Number(it.amount),
        cell: (it) => fmtAmount(it.amount),
      },
      {
        id: 'clearingAccount',
        header: 'Verrechnungskonto',
        type: 'text',
        accessor: (it) => it.clearingAccount?.name ?? '',
        cell: (it) => it.clearingAccount?.name || "—",
      },
      {
        id: 'paymentRequest',
        header: 'Auszahlungswunsch',
        type: 'text',
        accessor: (it) => it.paymentRequest ?? '',
        cell: (it) => (
          <span style={{ whiteSpace: 'pre-wrap' }}>
            {it.paymentRequest ? it.paymentRequest : <span className="kc-muted-dash">—</span>}
          </span>
        ),
      },
      {
        id: 'receiptUrl',
        header: 'Beleg',
        accessor: (it) => (it.receiptUrl ? 'ja' : 'nein'),
        sortable: false,
        filterable: false,
        cell: (it) =>
          it.receiptUrl ? (
            <a className="button" href={it.receiptUrl} target="_blank" rel="noopener noreferrer">Beleg herunterladen</a>
          ) : (
            <span className="kc-muted-dash">Kein Beleg</span>
          ),
      },
      {
        id: 'state',
        header: 'Status',
        type: 'text',
        accessor: (it) => String(it.state ?? ''),
        cell: (it) => (
          <span className={`kc-badge ${it.state === "open" ? "new" : it.state === "cancelled" ? "changed" : "same"}`}>
            {advanceStateLabel(it.state as AdvanceState)}
          </span>
        ),
      },
      {
        id: 'reason',
        header: 'Begründung',
        type: 'text',
        accessor: (it) => it.reason ?? '',
        cell: (it) => it.reason ?? "—",
      },
      {
        id: 'reviewer',
        header: 'Bearbeiter',
        type: 'text',
        accessor: (it) => (it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : ''),
        cell: (it) => (it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : "—"),
      },
      {
        id: 'cancel',
        header: 'Abbrechen',
        accessor: (it) => it.id,
        sortable: false,
        filterable: false,
        cell: (it) =>
          it.canCancel ? (
            <button className="button" onClick={() => cancelAdvance(it.id)} disabled={workingId === it.id}>
              {workingId === it.id ? "…" : "Abbrechen"}
            </button>
          ) : (
            "—"
          ),
      },
    ],
    [workingId, cancelAdvance]
  );

  const table = useClientTable(items ?? [], columns, { enableFilters: true });

  return (
    <div className="kc-page kc-table">
      <h1 className="kc-page-title">Meine Auslagen</h1>
      {error && <p className="kc-error">Fehler: {error}</p>}
      {loading && <p className="kc-status">Lade…</p>}
      {!loading && items && (
        <table className="kc-table advances-table">
          <ClientTableHead table={table} />
          <tbody>
            {table.filteredSortedRows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">Keine Auslagen gefunden.</td>
              </tr>
            ) : (
              table.filteredSortedRows.map((it) => (
                <tr key={it.id} className="kc-row">
                  {table.columns.map((c) => (
                    <td key={c.id}>{c.cell ? c.cell(it) : String(c.accessor(it) ?? '-') || '-'}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
