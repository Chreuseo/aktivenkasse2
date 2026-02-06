'use client';

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { extractToken, fetchJson } from "@/lib/utils";
import { Transaction } from "@/app/types/transaction";
import { BankAccount } from "@/app/types/bankAccount";
import TransactionTable from "@/app/components/TransactionTable";
import AllowancesTable from "@/app/components/AllowancesTable";

interface BankAccountDetail {
  bankAccount: BankAccount;
  transactions: Transaction[];
}

export default function BankAccountDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: session, status } = useSession();
  const [data, setData] = useState<{ bankAccount: BankAccount; planned: Transaction[]; past: Transaction[]; allowances: any[] } | null>(null);
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
        const url = `${baseUrl}/api/bank-accounts/${id}?withTransactions=true`.replace(/\/\/+/, "/");
        const json = await fetchJson(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        setData(json);
      } catch (e: any) {
        setError(e?.message || String(e));
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, id, status]);

  const planned = data?.planned || [];
  const past = data?.past || [];
  const allowances = data?.allowances || [];

  if (status === "loading" || !token) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Lade Session ...</div>;
  if (loading) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Lade Daten ...</div>;
  if (error) return <div style={{ color: "var(--accent)", margin: "2rem auto", maxWidth: 900 }}>{error}</div>;
  if (!data || !data.bankAccount) return <div style={{ color: "var(--accent)", margin: "2rem auto", maxWidth: 900 }}>Bankkonto-Daten konnten nicht geladen werden.</div>;
  const { bankAccount } = data;
  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Bankkonto-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{bankAccount.name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{bankAccount.bank}</div>
        <div style={{ marginBottom: 4 }}>Kontoinhaber: <span style={{ fontWeight: 600 }}>{bankAccount.owner}</span></div>
        <div style={{ fontWeight: 500 }}>IBAN: <span style={{ fontWeight: 700 }}>{bankAccount.iban}</span></div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{bankAccount.balance.toFixed(2)} €</span></div>
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
      <h3 style={{ margin: "1rem 0 0.6rem" }}>Geplante Transaktionen</h3>
      <TransactionTable transactions={planned} />

      {/* Vergangene Transaktionen */}
      <h3 style={{ margin: "1rem 0 0.6rem" }}>Vergangene Transaktionen</h3>
      <TransactionTable transactions={past} />
    </div>
  );
}
