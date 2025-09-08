'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { extractToken } from "@/lib/utils";
import { Transaction } from "@/app/types/transaction";
import TransactionTable from "@/app/components/TransactionTable";

export default function UserDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: session } = useSession();
  const [data, setData] = useState<{ user: { id: number; first_name: string; last_name: string; mail: string; balance: number }, transactions: Transaction[] } | null>(null);
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
        if (!res.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
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

  if (loading) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Lade Daten ...</div>;
  if (error) return <div style={{ color: "var(--accent)", margin: "2rem auto", maxWidth: 900 }}>{error}</div>;
  if (!data) return <div style={{ color: "var(--muted)", margin: "2rem auto", maxWidth: 900 }}>Nutzer nicht gefunden</div>;

  const { user, transactions } = data;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Nutzer-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{user.first_name} {user.last_name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{user.mail}</div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{Number(user.balance).toFixed(2)} €</span></div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
      <TransactionTable transactions={transactions} />
    </div>
  );
}
