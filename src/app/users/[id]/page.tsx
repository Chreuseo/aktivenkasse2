'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { extractToken } from "@/lib/utils";
import { Transaction } from "@/app/types/transaction";
import TransactionTable from "@/app/components/TransactionTable";

type UserPayload = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: number;
  accountId?: number;
};

export default function UserDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: session } = useSession();
  const [data, setData] = useState<{ user: UserPayload; planned: Transaction[]; past: Transaction[]; allowances: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const res = await fetch(`/api/users/${id}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || `${res.status} ${res.statusText}`);
          setData(null);
          return;
        }
        setData(json);
      } catch (e: any) {
        setError(e?.message || String(e));
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session, id]);

  const planned = data?.planned || [];
  const past = data?.past || [];
  const allowances = data?.allowances || [];

  if (loading) return <div className="kc-page kc-status">Lade Daten ...</div>;
  if (error) return <div className="kc-page kc-error">{error}</div>;
  if (!data) return <div className="kc-page kc-status">Nutzer nicht gefunden</div>;

  const { user } = data;

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Nutzer-Detailansicht</h2>
      <div className="kc-infobox">
        <div className="kc-infobox-title">{user.first_name} {user.last_name}</div>
        <div className="kc-infobox-subtitle">{user.mail}</div>
        <div className="kc-kv">Kontostand: <span className="kc-text-ok kc-fw-700">{Number((user as any).balance).toFixed(2)} €</span></div>
      </div>

      {/* Rückstellungen für dieses Konto */}
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
              <tr key={r.id} className="kc-row">
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.description || "-"}</td>
                <td className="kc-fw-600">{Number(r.amount).toFixed(2)} €</td>
                <td>{r.withheld ? Number(r.withheld).toFixed(2) + " €" : "-"}</td>
                <td>{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="kc-status">Keine Daten</div>
      )}

      {/* Geplante Transaktionen (unverarbeitet) */}
      <h3 className="kc-section-title kc-section-title--spaced">Geplante Transaktionen</h3>
      <TransactionTable transactions={planned} />

      {/* Vergangene Transaktionen (verarbeitet) */}
      <h3 className="kc-section-title kc-section-title--spaced">Vergangene Transaktionen</h3>
      <TransactionTable transactions={past} />
    </div>
  );
}
