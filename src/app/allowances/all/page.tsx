"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import "../../css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";

interface AllowanceRow {
  id: number;
  date: string;
  description?: string | null;
  amount: number;
  withheld: number;
  returnDate?: string | null;
  account: any;
}

export default function AllowancesOverviewPage() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<"open" | "returned" | "all">("open");
  const [rows, setRows] = useState<AllowanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const data = await fetchJson(`/api/allowances?filter=${filter}`, { headers });
        setRows(Array.isArray(data) ? data.map((d: any) => ({
          id: d.id,
          date: d.date,
          description: d.description ?? null,
          amount: Number(d.amount),
          withheld: Number(d.withheld || 0),
          returnDate: d.returnDate ?? null,
          account: d.account,
        })) : []);
      } catch (e: any) {
        setError(e?.message || "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter, session]);

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Rückstellungen</h2>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <label>
          Filter
          <select value={filter} onChange={e => setFilter(e.target.value as any)} className="kc-select" style={{ marginLeft: "0.5rem" }}>
            <option value="open">Offen</option>
            <option value="returned">Erstattet</option>
            <option value="all">Alle</option>
          </select>
        </label>
      </div>

      {loading && <div style={{ color: "var(--muted)" }}>Lade…</div>}
      {error && <div style={{ color: "var(--error)" }}>{error}</div>}

      {!loading && rows.length === 0 && <div style={{ color: "var(--muted)" }}>Keine Daten</div>}

      {rows.length > 0 && (
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
            {rows.map(r => (
              <tr key={r.id}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.description || "-"}</td>
                <td>{r.amount.toFixed(2)} €</td>
                <td>{r.withheld ? r.withheld.toFixed(2) + " €" : "-"}</td>
                <td>{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
