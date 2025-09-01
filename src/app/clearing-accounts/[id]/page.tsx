"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClearingAccount } from "@/app/types/clearingAccount";
import { Transaction } from "@/app/types/transaction";
import "@/app/css/infobox.css";
import "@/app/css/tables.css";
import TransactionTable from "@/app/components/TransactionTable";

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
      <TransactionTable transactions={data.transactions} />
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
