'use client';

import React from "react";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/tables.css";
import { ClientTableHead } from "@/app/components/clientTable/ClientTableHead";
import { useClientTable } from "@/app/components/clientTable/useClientTable";

interface TransactionTableProps {
  transactions: Transaction[];
}

export default function TransactionTable({ transactions }: TransactionTableProps) {
  const table = useClientTable(
    transactions,
    [
      {
        id: 'amount',
        header: 'Betrag',
        type: 'number',
        accessor: (tx: Transaction) => tx.amount,
        cell: (tx: Transaction) => (
          <span className={tx.amount < 0 ? 'kc-amount-neg' : 'kc-amount-pos'}>{tx.amount.toFixed(2)} €</span>
        ),
      },
      {
        id: 'date',
        header: 'Datum',
        type: 'date',
        accessor: (tx: Transaction) => tx.date,
        cell: (tx: Transaction) => new Date(tx.date).toLocaleDateString(),
      },
      {
        id: 'description',
        header: 'Beschreibung',
        type: 'text',
        accessor: (tx: Transaction) => tx.description,
      },
      {
        id: 'reference',
        header: 'Referenz',
        type: 'text',
        accessor: (tx: Transaction) => tx.reference ?? '',
        cell: (tx: Transaction) => tx.reference || '-',
      },
      {
        id: 'other',
        header: 'Gegenkonto',
        type: 'text',
        accessor: (tx: Transaction) =>
          tx.other
            ? `${tx.other.type}:${tx.other.name}${tx.other.type === 'bank' ? `:${(tx.other as any).bank ?? ''}` : ''}`
            : '',
        cell: (tx: Transaction) =>
          tx.other ? (
            <span>
              {tx.other.type === 'user' && `Nutzer: ${tx.other.name}`}
              {tx.other.type === 'bank' && `Bankkonto: ${tx.other.name} (${(tx.other as any).bank})`}
              {tx.other.type === 'clearing_account' && `Verrechnungskonto: ${tx.other.name}`}
            </span>
          ) : (
            <span className="kc-muted-dash">-</span>
          ),
      },
      {
        id: 'costCenterLabel',
        header: 'Kostenstelle',
        type: 'text',
        accessor: (tx: Transaction) => tx.costCenterLabel ?? '',
        cell: (tx: Transaction) => (tx.costCenterLabel ? tx.costCenterLabel : <span className="kc-muted-dash">-</span>),
      },
      {
        id: 'receipt',
        header: 'Beleg',
        type: 'text',
        accessor: (tx: Transaction) => (tx.receiptUrl ? 'ja' : 'nein'),
        filterable: false,
        sortable: false,
        cell: (tx: Transaction) =>
          tx.receiptUrl ? (
            <a href={`/api/transactions/${tx.id}/receipt`} target="_blank" rel="noopener noreferrer">
              <button className="button kc-btn--compact">Beleg herunterladen</button>
            </a>
          ) : (
            <span className="kc-muted-dash">Kein Beleg</span>
          ),
      },
      {
        id: 'bulkId',
        header: 'Sammel',
        type: 'text',
        accessor: (tx: Transaction) => tx.bulkId ?? '',
          filterable: false,
          sortable: false,
        cell: (tx: Transaction) =>
          tx.bulkId ? (
            <a href={`/transactions/bulk/${tx.bulkId}`}>
              <button className="button kc-btn--compact">Zur Sammelbuchung</button>
            </a>
          ) : (
            <span className="kc-muted-dash">-</span>
          ),
      },
    ],
    { enableFilters: true }
  );

  return (
    <table className="kc-table">
      <ClientTableHead table={table} />
      <tbody>
        {table.filteredSortedRows.length === 0 && (
          <tr>
            <td colSpan={8} className="kc-cell--center kc-cell--muted">
              Keine Transaktionen vorhanden
            </td>
          </tr>
        )}
        {table.filteredSortedRows.map((tx: Transaction) => (
          <tr key={tx.id} className={`kc-row${tx.processed === false ? " kc-row--dim" : ""}`}>
            {table.columns.map((c) => (
              <td key={c.id}>{c.cell ? c.cell(tx) : String(c.accessor(tx) ?? '-') || '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
