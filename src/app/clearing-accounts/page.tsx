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
    <div className="kc-page">
      <h2 className="kc-page-title">Verrechnungskonten Übersicht</h2>
      {error && (
        <div className="kc-error u-mb-2">❌ {error}</div>
      )}
      <table className="kc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Verantwortlicher</th>
            <th>Kontostand</th>
            <th>Erstattung</th>
            <th className="kc-col--members">Mitglieder</th>
            <th>Details</th>
              <th>Bearbeiten</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} className="kc-cell--center kc-cell--muted">Laden…</td>
            </tr>
          )}
          {!loading && accounts.length === 0 && (
            <tr>
              <td colSpan={7} className="kc-cell--center kc-cell--muted">Keine Verrechnungskonten vorhanden</td>
            </tr>
          )}
          {!loading && accounts.map((acc: ClearingAccount) => {
            const members = Array.isArray((acc as any)?.members) ? (acc as any).members as Array<{ name: string }> : [];
            return (
            <tr key={acc.id} className="kc-row">
              <td>{acc.name}</td>
              <td>{acc.responsible || <span className="kc-muted">-</span>}</td>
              <td className="kc-money">
                {Number((acc as any)?.balance ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </td>
              <td>{acc.reimbursementEligible ? "Ja" : "Nein"}</td>
              <td>{members.length > 0 ? (
                <ul className="kc-list kc-list--compact">
                  {members.map((m, idx) => (
                    <li key={idx}>{m?.name || "(ohne Namen)"}</li>
                  ))}
                </ul>
              ) : <span className="kc-muted">-</span>}</td>
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
