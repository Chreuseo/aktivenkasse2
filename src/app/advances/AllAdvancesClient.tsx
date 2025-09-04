"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";
import "../css/tables.css";
import "../css/forms.css";
import type { AdvanceListItem, AdvanceState } from "@/app/types/advance";
import { advanceStateLabel } from "@/app/types/advance";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Unbekannter Fehler";
}

export default function AllAdvancesClient() {
  const { data: session } = useSession();
  const [items, setItems] = useState<AdvanceListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("open");
  const [clearingAccountId, setClearingAccountId] = useState<string>("");
  const [clearingOptions, setClearingOptions] = useState<{ id: number; name: string }[]>([]);

  const statuses: { value: string; label: string }[] = [
    { value: "", label: "Alle" },
    { value: "open", label: advanceStateLabel("open") },
    { value: "cancelled", label: advanceStateLabel("cancelled") },
    { value: "accepted", label: advanceStateLabel("accepted") },
    { value: "rejected", label: advanceStateLabel("rejected") },
  ];

  const loadClearingAccounts = useCallback(async () => {
    try {
      const token = extractToken(session);
      const res = await fetch("/api/clearing-accounts", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) return setClearingOptions([]);
      const json = await res.json();
      if (Array.isArray(json)) {
        setClearingOptions(json.map((c: any) => ({ id: c.id, name: c.name })));
      } else {
        setClearingOptions([]);
      }
    } catch {
      setClearingOptions([]);
    }
  }, [session]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      } as Record<string, string>;

      let url = "/api/advances/all";
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (clearingAccountId) {
        // request per clearing-account endpoint
        url = "/api/advances/cost-center";
        params.set("clearingAccountId", clearingAccountId);
      }
      const full = params.toString() ? `${url}?${params.toString()}` : url;
      const res = await fetch(full, { method: "GET", headers });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Unbekannter Fehler");
        setItems([]);
        return;
      }
      const arr = Array.isArray(json.advances) ? json.advances : (json.items || []);
      // Normalize to AdvanceListItem[]; server may return amount as number or string
      const norm = arr.map((a: any): AdvanceListItem => ({
        id: a.id,
        date_advance: a.date_advance,
        description: a.description,
        amount: typeof a.amount === "number" ? String(a.amount) : a.amount,
        clearingAccount: a.clearingAccountId ? { id: a.clearingAccountId, name: a.clearingAccountName || (a.clearingAccount && a.clearingAccount.name) } : (a.clearingAccount || null),
        attachmentId: a.attachmentId || null,
        state: a.state as AdvanceState,
        reviewer: a.reviewer || null,
        canCancel: false,
        receiptUrl: a.receiptUrl || undefined,
      }));
      setItems(norm);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [session, status, clearingAccountId]);

  useEffect(() => {
    if (session) {
      void loadClearingAccounts();
      void load();
    }
  }, [session, loadClearingAccounts, load]);

  const fmtAmount = (v: string | number) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (!isFinite(n)) return String(v);
    try {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
    } catch {
      return Number(n).toFixed(2);
    }
  };

  return (
    <div className="table-center">
      <h1>Auslagenübersicht</h1>
      {error && <p style={{ color: "#f87171" }}>Fehler: {error}</p>}

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontWeight: 600, marginBottom: 6 }}>Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontWeight: 600, marginBottom: 6 }}>Verrechnungskonto</label>
            <select className="form-select form-select-max" value={clearingAccountId} onChange={(e) => setClearingAccountId(e.target.value)}>
              <option value="">— Alle —</option>
              {clearingOptions.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ alignSelf: "end" }}>
          <button className="button" onClick={() => void load()} disabled={loading}>Aktualisieren</button>
        </div>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "#888" }}>Keine Auslagen gefunden.</td>
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
                      {advanceStateLabel(it.state)}
                    </span>
                  </td>
                  <td>{it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
