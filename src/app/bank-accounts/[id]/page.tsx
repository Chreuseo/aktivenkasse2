'use client';

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { Transaction } from "@/app/types/transaction";

interface BankAccountDetail {
  bankAccount: {
    id: number;
    name: string;
    bank: string;
    iban: string;
    balance: number;
  };
  transactions: Transaction[];
}

function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || "";
}

export default function BankAccountDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: session, status } = useSession();
  const [data, setData] = useState<BankAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const token = extractToken(session);

  useEffect(() => {
    if (status !== "authenticated" || !token || !id) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
        const url = `${baseUrl}/api/bank-accounts/${id}`.replace(/\/\/+/, "/");
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Fehler beim Laden");
          setData(null);
        } else {
          setData(json);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, id, status]);

  if (status === "loading" || !token) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Lade Session ...</div>;
  if (loading) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Lade Daten ...</div>;
  if (error) return <div style={{ color: "var(--accent)", margin: "2rem auto", maxWidth: 900 }}>{error}</div>;
  if (!data) return null;
  const { bankAccount, transactions } = data;
  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Bankkonto-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{bankAccount.name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{bankAccount.bank}</div>
        <div style={{ fontWeight: 500 }}>IBAN: <span style={{ fontWeight: 700 }}>{bankAccount.iban}</span></div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{bankAccount.balance.toFixed(2)} €</span></div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
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
    </div>
  );
}
