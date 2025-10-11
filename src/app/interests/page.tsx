"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { BudgetPlan } from "@/app/types/budgetPlan";
import type { CostCenter } from "@/app/types/costCenter";

type DueRow = {
  id: number;
  accountId: number;
  accountType: string | null;
  accountLabel?: string;
  interestEnabled: boolean;
  amount: number;
  dueDate: string; // ISO
  paid: boolean;
  paidAt?: string | null;
  interestBilled: boolean;
  days: number;
  interest: number;
};

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "-";
  try {
    return new Intl.DateTimeFormat("de-DE").format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export default function InterestsPage() {
  // Filter: Paid (default: alle), Billed (default: noch nicht billed)
  const [includePaid, setIncludePaid] = useState<boolean>(true);
  const [includeUnpaid, setIncludeUnpaid] = useState<boolean>(true);
  const [includeBilled, setIncludeBilled] = useState<boolean>(false);
  const [includeUnbilled, setIncludeUnbilled] = useState<boolean>(true);

  const [listOpen, setListOpen] = useState<boolean>(false); // Dropdown sichtbar

  const [ratePercent, setRatePercent] = useState<number>(0);
  const [rows, setRows] = useState<DueRow[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Haushaltsplan/Kostenstelle
  const [budgetPlans, setBudgetPlans] = useState<BudgetPlan[]>([]);
  const [budgetPlanId, setBudgetPlanId] = useState<string>("");
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [costCenterId, setCostCenterId] = useState<string>("");

  const { data: session } = useSession();
  const token = useMemo(() => {
    return (
      (session as any)?.accessToken ||
      (session as any)?.token ||
      (session as any)?.user?.accessToken ||
      null
    ) as string | null;
  }, [session]);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  const allChecked = useMemo(() => rows.length > 0 && rows.every((r) => selected[r.id]), [rows, selected]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const params = new URLSearchParams();
      params.set("includePaid", String(includePaid));
      params.set("includeUnpaid", String(includeUnpaid));
      params.set("includeBilled", String(includeBilled));
      params.set("includeUnbilled", String(includeUnbilled));
      const res = await fetch(`/api/interests/list?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders,
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Fehler ${res.status}`;
        setError(msg);
        setRows([]);
        return;
      }
      setRatePercent(Number(data.ratePercent) || 0);
      setRows((data.rows || []) as DueRow[]);
      setSelected({});
    } catch (e: any) {
      setError(e?.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [includePaid, includeUnpaid, includeBilled, includeUnbilled, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  // Budgetpläne laden (nur aktive)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/budget-plan`, { headers: authHeaders, cache: "no-store" });
        const list = await res.json().catch(() => []);
        if (!cancelled) {
          const active = Array.isArray(list) ? list.filter((p: any) => p?.state === "active") : [];
          setBudgetPlans(active);
        }
      } catch {
        if (!cancelled) setBudgetPlans([]);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  // Kostenstellen zum gewählten Plan laden
  useEffect(() => {
    if (!budgetPlanId) {
      setCostCenters([]);
      setCostCenterId("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/budget-plan/cost-centers?planId=${budgetPlanId}`, { headers: authHeaders, cache: "no-store" });
        const list = await res.json().catch(() => []);
        if (!cancelled) setCostCenters(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setCostCenters([]);
      }
    })();
    return () => { cancelled = true; };
  }, [budgetPlanId, authHeaders]);

  const toggleAll = useCallback(() => {
    if (!rows.length) return;
    if (allChecked) {
      setSelected({});
    } else {
      const s: Record<number, boolean> = {};
      rows.forEach((r) => (s[r.id] = true));
      setSelected(s);
    }
  }, [rows, allChecked]);

  const totalInterest = useMemo(() => rows.reduce((sum, r) => sum + (r.interest || 0), 0), [rows]);

  const bill = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      if (!costCenterId) {
        setError("Bitte zuerst Budgetplan und Kostenstelle wählen.");
        return;
      }
      const ids = rows.filter((r) => selected[r.id]).map((r) => r.id);
      const base: any = ids.length
        ? { ids }
        : { includePaid, includeUnpaid, includeBilled, includeUnbilled };
      const body = { ...base, costCenterId: Number(costCenterId) };

      const res = await fetch("/api/interests/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders || {}) },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Fehler ${res.status}`;
        setError(msg);
        return;
      }
      const lines = [
        `Abgeschlossen: verarbeitet ${data.processed ?? 0}, Zins-Transaktionen erzeugt ${data.txCreated ?? 0}.`,
      ];
      setStatus(lines.join("\n"));
      await load();
    } catch (e: any) {
      setError(e?.message || "Fehler bei der Zinsanlage");
    } finally {
      setLoading(false);
    }
  }, [rows, selected, includePaid, includeUnpaid, includeBilled, includeUnbilled, load, authHeaders, costCenterId]);

  return (
    <div className="wide-container" style={{ width: "100%", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Zinsrechnung</h1>

      {/* Filter-Dropdown */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ position: "relative" }}>
          <button className="button" style={{ background: "#f8fafc", color: "#111827", border: "1px solid #e5e7eb" }} onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
            Filter
          </button>
          {listOpen && (
            <div style={{ position: "absolute", zIndex: 10, background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", borderRadius: 6, padding: 10, minWidth: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Paid</div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={includePaid} onChange={(e) => setIncludePaid(e.target.checked)} />
                <span>Bezahlt (paid)</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={includeUnpaid} onChange={(e) => setIncludeUnpaid(e.target.checked)} />
                <span>Unbezahlt (unpaid)</span>
              </label>
              <div style={{ height: 8 }} />
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Billed</div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={includeBilled} onChange={(e) => setIncludeBilled(e.target.checked)} />
                <span>Berechnet (billed)</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={includeUnbilled} onChange={(e) => setIncludeUnbilled(e.target.checked)} />
                <span>Noch nicht berechnet (unbilled)</span>
              </label>
              <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="button" style={{ background: "#f8fafc", color: "#111827", border: "1px solid #e5e7eb" }} onClick={() => { setListOpen(false); load(); }}>Anwenden</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ color: "#64748b" }}>
          Zinssatz: <strong>{ratePercent.toLocaleString("de-DE")} % p.a.</strong> — Summe berechnete Zinsen: <strong>{formatCurrency(totalInterest)}</strong>
        </div>
      </div>

      {/* Auswahl Haushaltsplan/Kostenstelle */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Budgetplan (Pflicht)
          <select
            value={budgetPlanId}
            onChange={(e) => setBudgetPlanId(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">Bitte wählen</option>
            {budgetPlans.map((bp) => (
              <option key={bp.id} value={String(bp.id)}>{bp.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Kostenstelle (Pflicht)
          <select
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
            disabled={!budgetPlanId}
            style={{ minWidth: 220 }}
          >
            <option value="">Bitte wählen</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={String(cc.id)}>{cc.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Tabelle */}
      <section className="table-center" style={{ width: "100%" }}>
        <table className="kc-table">
          <thead>
            <tr>
              <th className="kc-checkbox"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Alle auswählen" /></th>
              <th>Due</th>
              <th>Konto</th>
              <th>Typ</th>
              <th>Betrag</th>
              <th>Fälligkeit</th>
              <th>Paid</th>
              <th>Billed</th>
              <th>Tage</th>
              <th>Zinsen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 12 }}>Laden…</td></tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 12, color: "#94a3b8" }}>Keine Einträge für die aktuelle Auswahl.</td></tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="kc-row">
                <td className="kc-checkbox">
                  <input type="checkbox" checked={selected[r.id] ?? false} onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))} aria-label={`Auswählen Due #${r.id}`} />
                </td>
                <td>#{r.id}</td>
                <td>{r.accountLabel || r.accountId}</td>
                <td>{r.accountType || "-"}{!r.interestEnabled ? " (zinsfrei)" : ""}</td>
                <td>{formatCurrency(r.amount)}</td>
                <td>{formatDate(r.dueDate)}</td>
                <td>{r.paid ? "ja" : "nein"}</td>
                <td>{r.interestBilled ? "ja" : "nein"}</td>
                <td>{r.days}</td>
                <td>{formatCurrency(r.interest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="button" onClick={bill} disabled={loading || (!rows.length) || !costCenterId}>
          Zinsen anlegen
        </button>
        {status ? <span className="message" style={{ whiteSpace: "pre-line" }}>{status}</span> : null}
        {error ? <span className="message" style={{ color: "#ef4444" }}>{error}</span> : null}
      </div>
    </div>
  );
}
