"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClearingAccount } from "@/app/types/clearingAccount";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/infobox.css";
import "@/app/css/tables.css";

interface ClearingAccountData extends ClearingAccount {
  canEdit: boolean;
  transactions: Transaction[];
}

export default function ClearingAccountOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session } = useSession();
  const resolvedParams = React.use(params);
  const [data, setData] = useState<ClearingAccountData | null>(null);
  const [error, setError] = useState<string>("");
  useEffect(() => {
    async function loadData() {
      try {
        const token = extractToken(session);
        const json = await fetchJson(`/api/clearing-accounts/${resolvedParams.id}`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setData(json);
      } catch (err: any) {
        setError(err.message);
      }
    }
    loadData();
  }, [session, resolvedParams.id]);

  if (error) return <div className="kc-infobox" style={{ color: "#e11d48" }}>❌ {error}</div>;
  if (!data) return <div className="kc-infobox">Lade Daten...</div>;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Verrechnungskonto-Übersicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{data.name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>
          Verantwortlicher: {data.responsible ? `${data.responsible} (${data.responsibleMail})` : "Keiner"}
        </div>
        <div style={{ fontWeight: 500 }}>
          Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{data.balance.toFixed(2)} €</span>
        </div>
        <div>
          Erstattungsberechtigt: <span style={{ fontWeight: 600 }}>{data.reimbursementEligible ? "Ja" : "Nein"}</span>
        </div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
      <table className="kc-table compact">
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
          {data.transactions.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Transaktionen vorhanden</td></tr>
          )}
          {data.transactions.map((tx: Transaction) => (
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
      {data.canEdit && (
        <div style={{ marginTop: "2rem" }}>
          <a href={`/clearing-accounts/${data.id}/edit`}>
            <button className="button">Bearbeiten</button>
          </a>
        </div>
      )}
    </div>
  );
}
