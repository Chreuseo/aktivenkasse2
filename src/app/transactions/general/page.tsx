'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { Transaction } from "@/app/types/transaction";
import GeneralTransactionTable from "@/app/components/GeneralTransactionTable";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";

export default function GeneralTransactionsPage() {
  const { data: session } = useSession();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const res = await fetch('/api/transactions/general', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
        setTransactions(json as Transaction[]);
      } catch (e: any) {
        setError(e?.message || String(e));
        setTransactions(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  if (loading) {
    return <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem", color: 'var(--muted)' }}>Lade Daten ...</div>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
        <h2 style={{ marginBottom: "1rem" }}>Alle Buchungen ohne Gegenkonto (Beträge negiert)</h2>
        <p>Fehler beim Laden: {error}</p>
      </div>
    );
  }

  if (!transactions) {
    return (
      <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem", color: 'var(--muted)' }}>
        Keine Daten
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Alle Buchungen ohne Gegenkonto (Beträge negiert)</h2>
      <GeneralTransactionTable transactions={transactions} />
    </div>
  );
}
