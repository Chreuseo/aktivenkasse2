import React from "react";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/tables.css";

interface TransactionTableProps {
  transactions: Transaction[];
}

export default function TransactionTable({ transactions }: TransactionTableProps) {
  return (
    <table className="kc-table">
      <thead>
        <tr>
          <th>Betrag</th>
          <th>Datum</th>
          <th>Beschreibung</th>
          <th>Referenz</th>
          <th>Gegenkonto</th>
        </tr>
      </thead>
      <tbody>
        {transactions.length === 0 && (
          <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Transaktionen vorhanden</td></tr>
        )}
        {transactions.map((tx: Transaction) => (
          <tr key={tx.id} className="kc-row">
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}

