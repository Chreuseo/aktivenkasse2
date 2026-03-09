"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClearingAccount } from "@/app/types/clearingAccount";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable, type ColumnDef } from "@/app/components/clientTable/useClientTable";

export default function ClearingAccountsPage() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<ClearingAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const token = extractToken(session);
        const data = await fetchJson("/api/clearing-accounts", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!cancelled) setAccounts(data as ClearingAccount[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const columns = useMemo<ColumnDef<ClearingAccount>[]>(
    () => [
      { id: 'name', header: 'Name', type: 'text', accessor: (acc) => acc.name },
      { id: 'responsible', header: 'Verantwortlicher', type: 'text', accessor: (acc) => (acc as any).responsible ?? '', cell: (acc) => (acc as any).responsible || <span className="kc-muted">-</span> },
      {
        id: 'balance',
        header: 'Kontostand',
        type: 'number',
        accessor: (acc) => Number((acc as any)?.balance ?? 0),
        cell: (acc) => Number((acc as any)?.balance ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" }),
      },
      {
        id: 'reimbursementEligible',
        header: 'Erstattung',
        type: 'boolean',
        accessor: (acc) => Boolean((acc as any).reimbursementEligible),
        cell: (acc) => ((acc as any).reimbursementEligible ? "Ja" : "Nein"),
      },
      {
        id: 'members',
        header: 'Mitglieder',
        type: 'text',
        accessor: (acc) => {
          const members = Array.isArray((acc as any)?.members) ? (acc as any).members as Array<{ name: string }> : [];
          return members.map(m => m?.name || "").join(", ");
        },
        cell: (acc) => {
          const members = Array.isArray((acc as any)?.members) ? (acc as any).members as Array<{ name: string }> : [];
          return members.length > 0 ? (
            <ul className="kc-list kc-list--compact">
              {members.map((m, idx) => (
                <li key={idx}>{m?.name || "(ohne Namen)"}</li>
              ))}
            </ul>
          ) : <span className="kc-muted">-</span>;
        },
      },
      {
        id: 'details',
        header: 'Details',
        accessor: (acc) => acc.id,
        sortable: false,
        filterable: false,
        cell: (acc) => (
          <Link href={`/clearing-accounts/${acc.id}`}><button className="button">Details</button></Link>
        ),
      },
      {
        id: 'edit',
        header: 'Bearbeiten',
        accessor: (acc) => acc.id,
        sortable: false,
        filterable: false,
        cell: (acc) => (
          <Link href={`/clearing-accounts/${acc.id}/edit`}><button className="button">Bearbeiten</button></Link>
        ),
      },
    ],
    []
  );

  const table = useClientTable(accounts, columns, { enableFilters: true });

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Verrechnungskonten Übersicht</h2>
      {error && (
        <div className="kc-error u-mb-2">❌ {error}</div>
      )}
      <table className="kc-table">
        <ClientTableHead table={table} />
        <tbody>
          {loading && (
            <tr>
              <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">Laden…</td>
            </tr>
          )}
          {!loading && table.filteredSortedRows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">Keine Verrechnungskonten vorhanden</td>
            </tr>
          )}
          {!loading && table.filteredSortedRows.map((acc) => (
            <tr key={acc.id} className="kc-row">
              {table.columns.map((c) => (
                <td key={c.id}>{c.cell ? c.cell(acc) : String(c.accessor(acc) ?? '-') || '-'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
