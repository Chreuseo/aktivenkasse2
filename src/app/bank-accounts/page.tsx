'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";

// Utility für Token-Extraktion
function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || "";
}

type BankAccount = {
  id: number;
  name: string;
  bank: string;
  iban: string;
  balance: string | number;
};

export default function BankAccountsOverview() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        // TODO: API-Route /api/bank-accounts implementieren
        const res = await fetch("/api/bank-accounts", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Fehler beim Laden");
          setAccounts([]);
        } else {
          setAccounts(json);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setAccounts([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 16 }}>Bankkontenübersicht</h2>
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Bank</th>
            <th>IBAN</th>
            <th>Kontostand</th>
            <th>Bearbeiten</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(acc => (
            <tr key={acc.id} className="kc-row">
              <td>{acc.name}</td>
              <td>{acc.bank}</td>
              <td>{acc.iban}</td>
              <td>{typeof acc.balance === "string" ? acc.balance : Number(acc.balance).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</td>
              <td>
                <button className="button" disabled>
                  Bearbeiten
                </button>
                {/* TODO: Bearbeiten-Funktion */}
              </td>
              <td>
                <button className="button" onClick={() => window.location.href = `/bank-accounts/${acc.id}`}>
                  Details
                </button>
                {/* TODO: Detailseite */}
              </td>
            </tr>
          ))}
          {accounts.length === 0 && !loading && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Bankkonten gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

