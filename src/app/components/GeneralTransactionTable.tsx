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
          <th>Datum</th>
          <th>Beschreibung</th>
          <th>Referenz</th>
          <th>Gegenkonto</th>
          <th>Kostenstelle</th>
          <th>Beleg</th>
        </tr>
      </thead>
      <tbody>
        {transactions.length === 0 && (
          <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Transaktionen vorhanden</td></tr>
        )}
        {transactions.map((tx: Transaction) => (
          <tr key={tx.id} className="kc-row">
            <td>
              {tx.main ? (
                <span>
                  {tx.main.type === "user" && `Nutzer: ${tx.main.name}`}
                  {tx.main.type === "bank" && `Bankkonto: ${tx.main.name} (${tx.main.bank})`}
                  {tx.main.type === "clearing_account" && `Verrechnungskonto: ${tx.main.name}`}
                </span>
              ) : <span style={{ color: "var(--muted)" }}>-</span>}
            </td>
            <td style={{ color: tx.amount < 0 ? "#e11d48" : "#059669", fontWeight: 600 }}>{tx.amount.toFixed(2)} €</td>
            <td>{new Date(tx.date).toLocaleDateString()}</td>
            <td>{tx.description}</td>
            <td>{tx.reference || "-"}</td>
            <td>
              {tx.other ? (
                <span>
                  {tx.other.type === "user" && `Nutzer: ${tx.other.name}`}
                  {tx.other.type === "bank" && `Bankkonto: ${tx.other.name} (${tx.other.bank})`}
                  {tx.other.type === "clearing_account" && `Verrechnungskonto: ${tx.other.name}`}
                </span>
              ) : <span style={{ color: "var(--muted)" }}>-</span>}
            </td>
            <td>{tx.costCenterLabel ? tx.costCenterLabel : <span style={{ color: "var(--muted)" }}>-</span>}</td>
            <td>
              {tx.receiptUrl ? (
                <a href={`/api/transactions/${tx.id}/receipt`} target="_blank" rel="noopener noreferrer">
                  <button className="button" style={{ padding: "0.2rem 0.8rem" }}>Beleg herunterladen</button>
                </a>
              ) : <span style={{ color: "var(--muted)" }}>Kein Beleg</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
