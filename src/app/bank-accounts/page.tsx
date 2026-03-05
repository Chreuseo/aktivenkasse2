'use client';

import React, { useCallback, useEffect, useMemo, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { BankAccount } from "@/app/types/bankAccount";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable, type ColumnDef } from "@/app/components/clientTable/useClientTable";

export default function BankAccountsOverview() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // robuster Formatter für EUR
  const currencyFmt = useMemo(() => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }), []);
  const formatBalance = useCallback((value: unknown) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? currencyFmt.format(num) : "—";
  }, [currencyFmt]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const json = await fetchJson("/api/bank-accounts", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setAccounts(json);
      } catch (e: any) {
        setError(e?.message || String(e));
        setAccounts([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  const columns = useMemo<ColumnDef<BankAccount>[]>(
    () => [
      { id: 'name', header: 'Name', type: 'text', accessor: (a) => a.name },
      { id: 'owner', header: 'Kontoinhaber', type: 'text', accessor: (a) => a.owner },
      { id: 'bank', header: 'Bank', type: 'text', accessor: (a) => a.bank },
      { id: 'iban', header: 'IBAN', type: 'text', accessor: (a) => a.iban },
      {
        id: 'balance',
        header: 'Kontostand',
        type: 'number',
        accessor: (a) => Number((a as any).balance ?? 0),
        cell: (a) => formatBalance((a as any).balance),
      },
      {
        id: 'edit',
        header: 'Bearbeiten',
        accessor: (a) => a.id,
        sortable: false,
        filterable: false,
        cell: (a) => (
          <button className="button" onClick={() => window.location.href = `/bank-accounts/${a.id}/edit`}>
            Bearbeiten
          </button>
        ),
      },
      {
        id: 'details',
        header: 'Details',
        accessor: (a) => a.id,
        sortable: false,
        filterable: false,
        cell: (a) => (
          <button className="button" onClick={() => window.location.href = `/bank-accounts/${a.id}`}>
            Details
          </button>
        ),
      },
    ],
    [formatBalance]
  );

  const table = useClientTable(accounts, columns, { enableFilters: true });

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Bankkontenübersicht</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      <table className="kc-table" role="table">
        <ClientTableHead table={table} />
        <tbody>
          {table.filteredSortedRows.map(acc => (
            <tr key={acc.id} className="kc-row">
              {table.columns.map((c) => (
                <td key={c.id}>{c.cell ? c.cell(acc) : String(c.accessor(acc) ?? '-') || '-'}</td>
              ))}
            </tr>
          ))}
          {table.filteredSortedRows.length === 0 && !loading && (
            <tr><td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">Keine Bankkonten gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
