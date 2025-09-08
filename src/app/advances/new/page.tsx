"use client";

import React, { useEffect, useState } from "react";
import NewAdvanceForm from "./NewAdvanceForm";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";

export default function NewAdvancePage() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const res = await fetch("/api/clearing-accounts", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) {
          const msg = json?.error || `${res.status} ${res.statusText}`;
          setError(msg);
          setAccounts([]);
          return;
        }
        const list: Array<{ id: number; name: string }> = (Array.isArray(json) ? json : []).map((a: any) => ({ id: a.id, name: a.name }));
        setAccounts(list);
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
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Verrechnungskonten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <NewAdvanceForm accounts={accounts} />
    </div>
  );
}
