"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";
import "../../css/tables.css";

import type { AdvanceListItem, AdvanceState } from "@/app/types/advance";
import { advanceStateLabel } from "@/app/types/advance";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Unbekannter Fehler";
}

export default function MineAdvancesClient() {
  const { data: session } = useSession();
  const [items, setItems] = useState<AdvanceListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/advances/mine", {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Unbekannter Fehler");
      setItems(json.items as AdvanceListItem[]);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const cancelAdvance = async (id: number) => {
    if (!confirm("Auslage wirklich abbrechen?")) return;
    setWorkingId(id);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/advances", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Unbekannter Fehler");
      // Refresh list
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setWorkingId(null);
    }
  };

  const fmtAmount = (v: string | number) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (!isFinite(n)) return String(v);
    try {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };

  return (
    <div className="table-center">
      <h1>Meine Auslagen</h1>
      {error && <p style={{ color: "#f87171" }}>Fehler: {error}</p>}
      {loading && <p>Lade…</p>}
      {!loading && items && (
        <table className="kc-table advances-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Beschreibung</th>
              <th>Betrag</th>
              <th>Verrechnungskonto</th>
              <th>Beleg</th>
              <th>Status</th>
              <th>Bearbeiter</th>
              <th>Abbrechen</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#888" }}>Keine Auslagen gefunden.</td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="kc-row">
                  <td>{new Date(it.date_advance).toLocaleDateString("de-DE")}</td>
                  <td>{it.description}</td>
                  <td>{fmtAmount(it.amount)}</td>
                  <td>{it.clearingAccount?.name || "—"}</td>
                  <td>
                    {it.receiptUrl ? (
                      <a className="button" href={it.receiptUrl} target="_blank" rel="noopener noreferrer">Beleg herunterladen</a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Kein Beleg</span>
                    )}
                  </td>
                  <td>
                    <span className={`kc-badge ${it.state === "open" ? "new" : it.state === "cancelled" ? "changed" : "same"}`}>
                      {advanceStateLabel(it.state as AdvanceState)}
                    </span>
                  </td>
                  <td>{it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : "—"}</td>
                  <td>
                    {it.canCancel ? (
                      <button className="button" onClick={() => cancelAdvance(it.id)} disabled={workingId === it.id}>
                        {workingId === it.id ? "…" : "Abbrechen"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
