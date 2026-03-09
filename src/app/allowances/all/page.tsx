"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import "../../css/tables.css";
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
  account: any;
}

function getNameFromAccount(account: any): string {
  const acc = account || {};
  const user = Array.isArray(acc.users) && acc.users[0] ? acc.users[0] : null;
  const bank = Array.isArray(acc.bankAccounts) && acc.bankAccounts[0] ? acc.bankAccounts[0] : null;
  const clearing = Array.isArray(acc.clearingAccounts) && acc.clearingAccounts[0] ? acc.clearingAccounts[0] : null;
  return user ? `${user.first_name} ${user.last_name}` : bank ? bank.name : clearing ? clearing.name : "-";
}

export default function AllowancesOverviewPage() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<"open" | "returned" | "all">("open");
  const [rows, setRows] = useState<AllowanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const data = await fetchJson(`/api/allowances?filter=${filter}`, { headers });
        setRows(Array.isArray(data) ? data.map((d: any) => ({
          id: d.id,
          date: d.date,
          description: d.description ?? null,
          amount: Number(d.amount),
          withheld: Number(d.withheld || 0),
          returnDate: d.returnDate ?? null,
          account: d.account,
        })) : []);
      } catch (e: any) {
        setError(e?.message || "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter, session]);

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
        id: 'name',
        header: 'Name',
        type: 'text',
        accessor: (r) => getNameFromAccount(r.account),
        cell: (r) => getNameFromAccount(r.account),
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
        cell: (r) => r.amount.toFixed(2) + " €",
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

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Rückstellungen</h2>
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

      {!loading && table.filteredSortedRows.length === 0 && <div className="kc-status">Keine Daten</div>}

      {table.filteredSortedRows.length > 0 && (
        <table className="kc-table">
          <ClientTableHead table={table} />
          <tbody>
            {table.filteredSortedRows.map(r => (
              <tr key={r.id} className="kc-row">
                {table.columns.map((c) => (
                  <td key={c.id}>{c.cell ? c.cell(r) : String(c.accessor(r) ?? '-') || '-'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
