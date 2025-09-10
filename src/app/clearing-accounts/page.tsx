"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import { ClearingAccount } from "@/app/types/clearingAccount";

export default function ClearingAccountsPage() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<ClearingAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const token = extractToken(session);
        const data = await fetchJson("/api/clearing-accounts", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!cancelled) setAccounts(data as ClearingAccount[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Verrechnungskonten Übersicht</h2>
      {error && (
        <div style={{ color: "#e11d48", marginBottom: "0.8rem" }}>❌ {error}</div>
      )}
      <table className="kc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Verantwortlicher</th>
            <th>Kontostand</th>
            <th>Erstattung</th>
            <th>Mitglieder</th>
            <th>Details</th>
              <th>Bearbeiten</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>Laden…</td>
            </tr>
          )}
          {!loading && accounts.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Verrechnungskonten vorhanden</td>
            </tr>
          )}
          {!loading && accounts.map((acc: ClearingAccount) => {
            const members = Array.isArray((acc as any)?.members) ? (acc as any).members as Array<{ name: string }> : [];
            return (
            <tr key={acc.id} className="kc-row">
              <td>{acc.name}</td>
              <td>{acc.responsible || <span style={{ color: "var(--muted)" }}>-</span>}</td>
              <td style={{ fontWeight: 600, color: "var(--primary)" }}>
                {Number((acc as any)?.balance ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </td>
              <td>{acc.reimbursementEligible ? "Ja" : "Nein"}</td>
              <td>{members.length > 0 ? members.map(m => m.name).join(", ") : <span style={{ color: "var(--muted)" }}>-</span>}</td>
                <td><Link href={`/clearing-accounts/${acc.id}`}><button className="button">Details</button></Link></td>
              <td><Link href={`/clearing-accounts/${acc.id}/edit`}><button className="button">Bearbeiten</button></Link></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
