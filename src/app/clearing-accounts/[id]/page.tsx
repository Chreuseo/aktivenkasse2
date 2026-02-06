"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClearingAccount } from "@/app/types/clearingAccount";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/infobox.css";
import "@/app/css/tables.css";
import TransactionTable from "@/app/components/TransactionTable";
import AllowancesTable from "@/app/components/AllowancesTable";

interface ClearingAccountData extends ClearingAccount {
  canEdit: boolean;
  transactions: Transaction[];
}

export default function ClearingAccountOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session } = useSession();
  const resolvedParams = React.use(params);
  const [data, setData] = useState<{ clearingAccount: ClearingAccount; planned: Transaction[]; past: Transaction[]; allowances: any[] } | null>(null);
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

  const planned = data?.planned || [];
  const past = data?.past || [];
  const allowances = data?.allowances || [];

  if (error) return <div className="kc-infobox" style={{ color: "#e11d48" }}>❌ {error}</div>;
  if (!data) return <div className="kc-infobox">Lade Daten...</div>;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Verrechnungskonto-Übersicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{data.clearingAccount.name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>
          Verantwortlicher: {data.clearingAccount.responsible ? `${data.clearingAccount.responsible} (${data.clearingAccount.responsibleMail})` : "Keiner"}
        </div>
        <div style={{ fontWeight: 500 }}>
          Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{data.clearingAccount.balance.toFixed(2)} €</span>
        </div>
        <div>
          Erstattungsberechtigt: <span style={{ fontWeight: 600 }}>{data.clearingAccount.reimbursementEligible ? "Ja" : "Nein"}</span>
        </div>
      </div>

      {/* Rückstellungen */}
      <h3 style={{ marginBottom: "0.8rem" }}>Rückstellungen</h3>
      {allowances.length > 0 ? (
        <table className="kc-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Beschreibung</th>
              <th>Betrag</th>
              <th>Einbehalt</th>
              <th>Erstattung (Datum)</th>
            </tr>
          </thead>
          <tbody>
            {allowances.map((r: any) => (
              <tr key={r.id}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.description || "-"}</td>
                <td>{Number(r.amount).toFixed(2)} €</td>
                <td>{r.withheld ? Number(r.withheld).toFixed(2) + " €" : "-"}</td>
                <td>{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ color: "var(--muted)" }}>Keine Daten</div>
      )}

      {/* Geplante Transaktionen */}
      <h3 style={{ marginBottom: "0.8rem", marginTop: "1rem" }}>Geplante Transaktionen</h3>
      <TransactionTable transactions={planned} />

      {/* Vergangene Transaktionen */}
      <h3 style={{ marginBottom: "0.8rem", marginTop: "1rem" }}>Vergangene Transaktionen</h3>
      <TransactionTable transactions={past} />
    </div>
  );
}
