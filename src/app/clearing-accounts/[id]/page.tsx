"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { Transaction } from "@/app/types/transaction";
import { ClearingAccount } from "@/app/types/clearingAccount";
import "@/app/css/infobox.css";
import "@/app/css/tables.css";
import TransactionTable from "@/app/components/TransactionTable";

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

  if (error) return <div className="kc-infobox kc-error">❌ {error}</div>;
  if (!data) return <div className="kc-infobox kc-status">Lade Daten...</div>;

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Verrechnungskonto-Übersicht</h2>
      <div className="kc-infobox">
        <div className="kc-infobox-title">{data.clearingAccount.name}</div>
        <div className="kc-infobox-subtitle">
          Verantwortlicher: {data.clearingAccount.responsible ? `${data.clearingAccount.responsible} (${data.clearingAccount.responsibleMail})` : "Keiner"}
        </div>
        <div className="kc-kv">
          Kontostand: <span className="kc-money">{data.clearingAccount.balance.toFixed(2)} €</span>
        </div>
        <div>
          Erstattungsberechtigt: <span className="kc-fw-600">{data.clearingAccount.reimbursementEligible ? "Ja" : "Nein"}</span>
        </div>
      </div>

      {/* Rückstellungen */}
      <h3 className="kc-section-title">Rückstellungen</h3>
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
        <div className="kc-muted">Keine Daten</div>
      )}

      {/* Geplante Transaktionen */}
      <h3 className="kc-section-title kc-section-title--spaced">Geplante Transaktionen</h3>
      <TransactionTable transactions={planned} />

      {/* Vergangene Transaktionen */}
      <h3 className="kc-section-title kc-section-title--spaced">Vergangene Transaktionen</h3>
      <TransactionTable transactions={past} />
    </div>
  );
}
