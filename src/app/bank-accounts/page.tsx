'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { BankAccount } from "@/app/types/bankAccount";

export default function BankAccountsOverview() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // robuster Formatter für EUR
  const currencyFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const formatBalance = (value: unknown) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? currencyFmt.format(num) : "—";
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const json = await fetchJson("/api/bank-accounts", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setAccounts(json);
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
    <div className="kc-page">
      <h2 className="kc-page-title">Bankkontenübersicht</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kontoinhaber</th>
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
              <td>{acc.owner}</td>
              <td>{acc.bank}</td>
              <td>{acc.iban}</td>
              <td>{formatBalance(acc.balance)}</td>
              <td>
                <button className="button" onClick={() => window.location.href = `/bank-accounts/${acc.id}/edit`}>
                  Bearbeiten
                </button>
              </td>
              <td>
                <button className="button" onClick={() => window.location.href = `/bank-accounts/${acc.id}`}>
                  Details
                </button>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && !loading && (
            <tr><td colSpan={7} className="kc-cell--center kc-cell--muted">Keine Bankkonten gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
