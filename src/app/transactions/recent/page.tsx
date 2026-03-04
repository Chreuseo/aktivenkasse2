'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { Transaction } from "@/app/types/transaction";
import GeneralTransactionTable from "@/app/components/GeneralTransactionTable";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";

export default function RecentTransactionsPage() {
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
        const res = await fetch('/api/transactions/recent', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || `${res.status} ${res.statusText}`);
          setTransactions(null);
          return;
        }
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
    return (
      <div className="kc-page kc-status">
        Lade Daten ...
      </div>
    );
  }

  if (error) {
    return (
      <div className="kc-page">
        <h2 className="kc-page-title">Letzte 20 Buchungen (nach Erstellungsdatum)</h2>
        <p className="kc-error">Fehler beim Laden: {error}</p>
      </div>
    );
  }

  if (!transactions) {
    return (
      <div className="kc-page kc-status">
        Keine Daten
      </div>
    );
  }

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Letzte 20 Buchungen (nach Erstellungsdatum)</h2>
      <GeneralTransactionTable transactions={transactions} />
    </div>
  );
}
