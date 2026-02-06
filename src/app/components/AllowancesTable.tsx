"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import "@/app/css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";

interface AllowanceRow {
  id: number;
  date: string;
  description?: string | null;
  amount: number;
  withheld: number;
  returnDate?: string | null;
}

export default function AllowancesTable({ accountId, title = "Rückstellungen" }: { accountId: number | undefined; title?: string }) {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<"open" | "returned" | "all">("open");
  const [rows, setRows] = useState<AllowanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!accountId) {
        setRows([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const data = await fetchJson(`/api/allowances?filter=${filter}&accountId=${accountId}`, { headers });
        const list = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
        setRows(
          list.map((d: any) => ({
            id: d.id,
            date: d.date,
            description: d.description ?? null,
            amount: Number(d.amount),
            withheld: Number(d.withheld || 0),
            returnDate: d.returnDate ?? null,
          }))
        );
      } catch (e: any) {
        setError(e?.message || "Fehler beim Laden");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter, session, accountId]);

  const totalAmount = rows.reduce((sum, r) => sum + (isFinite(r.amount) ? r.amount : 0), 0);
  const totalWithheld = rows.reduce((sum, r) => sum + (isFinite(r.withheld) ? r.withheld : 0), 0);

  return (
    <div style={{ marginTop: "1rem" }}>
      <h3 style={{ marginBottom: "0.8rem" }}>{title}</h3>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem" }}>
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

      {rows.length > 0 ? (
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
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>Summe</td>
              <td style={{ fontWeight: 700 }}>{totalAmount.toFixed(2)} €</td>
              <td style={{ fontWeight: 700 }}>{totalWithheld.toFixed(2)} €</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      ) : (
        !loading && !error ? <div style={{ color: "var(--muted)" }}>Keine Daten</div> : null
      )}
    </div>
  );
}
