"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import "@/app/css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable, type ColumnDef } from "@/app/components/clientTable/useClientTable";

interface AllowanceRow {
  id: number;
  date: string;
  description?: string | null;
  amount: number;
  withheld: number;
  returnDate?: string | null;
}

export default function AllowancesTable({ accountId, title = "Rückstellungen" }: { accountId: number | undefined; title?: string }) {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<"open" | "returned" | "all">("open");
  const [rows, setRows] = useState<AllowanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!accountId) {
        setRows([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const data = await fetchJson(`/api/allowances?filter=${filter}&accountId=${accountId}`, { headers });
        const list = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
        setRows(
          list.map((d: any) => ({
            id: d.id,
            date: d.date,
            description: d.description ?? null,
            amount: Number(d.amount),
            withheld: Number(d.withheld || 0),
            returnDate: d.returnDate ?? null,
          }))
        );
      } catch (e: any) {
        setError(e?.message || "Fehler beim Laden");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter, session, accountId]);

  const columns = useMemo<ColumnDef<AllowanceRow>[]>(
    () => [
      {
        id: 'date',
        header: 'Datum',
        type: 'date',
        accessor: (r) => r.date,
        cell: (r) => new Date(r.date).toLocaleDateString(),
      },
      {
        id: 'description',
        header: 'Beschreibung',
        type: 'text',
        accessor: (r) => r.description ?? '',
        cell: (r) => r.description || "-",
      },
      {
        id: 'amount',
        header: 'Betrag',
        type: 'number',
        accessor: (r) => r.amount,
        cell: (r) => <span className="kc-fw-600">{r.amount.toFixed(2)} €</span>,
      },
      {
        id: 'withheld',
        header: 'Einbehalt',
        type: 'number',
        accessor: (r) => r.withheld,
        cell: (r) => (r.withheld ? r.withheld.toFixed(2) + " €" : "-"),
      },
      {
        id: 'returnDate',
        header: 'Erstattung (Datum)',
        type: 'date',
        accessor: (r) => r.returnDate ?? '',
        cell: (r) => (r.returnDate ? new Date(r.returnDate).toLocaleDateString() : "-"),
      },
    ],
    []
  );

  const table = useClientTable(rows, columns, { enableFilters: true });

  const totalAmount = table.filteredSortedRows.reduce((sum, r) => sum + (isFinite(r.amount) ? r.amount : 0), 0);
  const totalWithheld = table.filteredSortedRows.reduce((sum, r) => sum + (isFinite(r.withheld) ? r.withheld : 0), 0);

  return (
    <div className="u-mt-3">
      <h3 className="kc-section-title">{title}</h3>
      <div className="kc-filterbar">
        <label className="kc-formfield">
          Filter
          <select value={filter} onChange={e => setFilter(e.target.value as any)} className="kc-select kc-max-220">
            <option value="open">Offen</option>
            <option value="returned">Erstattet</option>
            <option value="all">Alle</option>
          </select>
        </label>
      </div>

      {loading && <div className="kc-status">Lade…</div>}
      {error && <div className="kc-error">{error}</div>}

      {rows.length > 0 ? (
        <table className="kc-table">
          <ClientTableHead table={table} />
          <tbody>
            {table.filteredSortedRows.map((r) => (
              <tr key={r.id} className="kc-row">
                {table.columns.map((c) => (
                  <td key={c.id}>{c.cell ? c.cell(r) : String(c.accessor(r) ?? '-') || '-'}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="kc-sum-label">Summe</td>
              <td className="kc-fw-700">{totalAmount.toFixed(2)} €</td>
              <td className="kc-fw-700">{totalWithheld.toFixed(2)} €</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      ) : (
        !loading && !error ? <div className="kc-status">Keine Daten</div> : null
      )}
    </div>
  );
}
