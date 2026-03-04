'use client';

import React from "react";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/tables.css";

interface GeneralTransactionTableProps {
  transactions: Transaction[];
}

export default function GeneralTransactionTable({ transactions }: GeneralTransactionTableProps) {
  return (
    <table className="kc-table">
      <thead>
        <tr>
          <th>Hauptkonto</th>
          <th>Betrag</th>
          <th>erzeugt am</th>
          <th>Wertstellung</th>
          <th>Beschreibung</th>
          <th>Referenz</th>
          <th>Gegenkonto</th>
          <th>Kostenstelle</th>
          <th>Beleg</th>
          <th>Sammel</th>
        </tr>
      </thead>
      <tbody>
        {transactions.length === 0 && (
          <tr><td colSpan={10} className="kc-cell--center kc-cell--muted">Keine Transaktionen vorhanden</td></tr>
        )}
        {transactions.map((tx: Transaction) => (
          <tr key={tx.id} className={`kc-row${tx.processed === false ? " kc-row--dim" : ""}`}>
            <td>
              {tx.main ? (
                <span>
                  {tx.main.type === "user" && `Nutzer: ${tx.main.name}`}
                  {tx.main.type === "bank" && `Bankkonto: ${tx.main.name} (${tx.main.bank})`}
                  {tx.main.type === "clearing_account" && `Verrechnungskonto: ${tx.main.name}`}
                </span>
              ) : <span className="kc-muted-dash">-</span>}
            </td>
            <td className={tx.amount < 0 ? "kc-amount-neg" : "kc-amount-pos"}>{tx.amount.toFixed(2)} €</td>
            <td>{new Date(tx.createdAt ?? tx.date).toLocaleDateString()}</td>
            <td>{tx.dateValued ? new Date(tx.dateValued).toLocaleDateString() : <span className="kc-muted-dash">-</span>}</td>
            <td>{tx.description}</td>
            <td>{tx.reference || "-"}</td>
            <td>
              {tx.other ? (
                <span>
                  {tx.other.type === "user" && `Nutzer: ${tx.other.name}`}
                  {tx.other.type === "bank" && `Bankkonto: ${tx.other.name} (${tx.other.bank})`}
                  {tx.other.type === "clearing_account" && `Verrechnungskonto: ${tx.other.name}`}
                </span>
              ) : <span className="kc-muted-dash">-</span>}
            </td>
            <td>{tx.costCenterLabel ? tx.costCenterLabel : <span className="kc-muted-dash">-</span>}</td>
            <td>
              {tx.receiptUrl ? (
                <a href={`/api/transactions/${tx.id}/receipt`} target="_blank" rel="noopener noreferrer">
                  <button className="button kc-btn--compact">Beleg herunterladen</button>
                </a>
              ) : <span className="kc-muted-dash">Kein Beleg</span>}
            </td>
            <td>
              {tx.bulkId ? (
                <a href={`/transactions/bulk/${tx.bulkId}`}>
                  <button className="button kc-btn--compact">Zur Sammelbuchung</button>
                </a>
              ) : <span className="kc-muted-dash">-</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
