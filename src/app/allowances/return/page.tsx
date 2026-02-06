"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";

interface AllowanceRow {
  id: number;
  amount: number;
  description?: string | null;
  account: any;
}

export default function AllowanceReturnPage() {
  const { data: session } = useSession();
  const [allowances, setAllowances] = useState<AllowanceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [withhold, setWithhold] = useState<boolean>(false);
  const [withholdAmount, setWithholdAmount] = useState<string>("");
  const [withholdDescription, setWithholdDescription] = useState<string>("");
  const [budgetPlans, setBudgetPlans] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [budgetPlanId, setBudgetPlanId] = useState<string>("");
  const [costCenterId, setCostCenterId] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetchJson("/api/allowances?filter=open", { headers })
      .then((list) => setAllowances(Array.isArray(list) ? list.map((d: any) => ({ id: d.id, amount: Number(d.amount), description: d.description ?? null, account: d.account })) : []))
      .catch(() => setAllowances([]));
    fetchJson("/api/budget-plan", { headers })
      .then((list) => setBudgetPlans(Array.isArray(list) ? list.filter((p: any) => p?.state === 'active') : []))
      .catch(() => setBudgetPlans([]));
  }, [session]);

  useEffect(() => {
    if (!budgetPlanId) {
      setCostCenters([]);
      setCostCenterId("");
      return;
    }
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetchJson(`/api/budget-plan/cost-centers?planId=${budgetPlanId}`, { headers })
      .then(setCostCenters)
      .catch(() => setCostCenters([]));
  }, [budgetPlanId, session]);

  const selected = useMemo(() => allowances.find(a => a.id === Number(selectedId)), [allowances, selectedId]);

  function getAccountDisplayName(acc: any): string {
    if (!acc) return "";
    const u = acc.users?.[0];
    if (u) return `${u.first_name} ${u.last_name}`;
    const b = acc.bankAccounts?.[0];
    if (b) return b.name || b.iban;
    const c = acc.clearingAccounts?.[0];
    if (c) return c.name;
    return String(acc.id || "Unbekannt");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      if (!selectedId) {
        setMessage("❌ Bitte Rückstellung wählen");
        setLoading(false);
        return;
      }
      if (withhold) {
        if (!withholdAmount || !withholdDescription || !budgetPlanId || !costCenterId) {
          setMessage("❌ Einbehalt: Betrag, Beschreibung, Haushaltsplan und Kostenstelle sind Pflicht");
          setLoading(false);
          return;
        }
      }
      const token = extractToken(session);
      const res = await fetch("/api/allowances/return", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          allowanceId: Number(selectedId),
          withhold: withhold,
          withholdAmount: withhold ? Math.abs(Number(withholdAmount)) : undefined,
          withholdDescription: withhold ? withholdDescription : undefined,
          budgetPlanId: withhold ? Number(budgetPlanId) : undefined,
          costCenterId: withhold ? Number(costCenterId) : undefined,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = "❌ Fehler bei Erstattung.";
        if (result?.error) msg += `\n${result.error}`;
        if (result?.detail) msg += `\n${result.detail}`;
        setMessage(msg);
      } else {
        setMessage("✅ Rückstellung erstattet!");
        setSelectedId("");
        setWithhold(false);
        setWithholdAmount("");
        setWithholdDescription("");
        setBudgetPlanId("");
        setCostCenterId("");
      }
    } catch (err: any) {
      setMessage("❌ " + (err?.message || "Serverfehler"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1>Rückstellung erstatten</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Rückstellung
          <select
            className="form-select form-select-max"
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            required
            style={{ maxWidth: "420px" }}
          >
            <option value="">Bitte wählen</option>
            {allowances.map(a => (
              <option key={a.id} value={a.id}>
                {getAccountDisplayName(a.account)}: {a.description || "-"} ({a.amount.toFixed(2)} €)
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={withhold} onChange={e => setWithhold(e.target.checked)} />
          Einbehalt
        </label>

        {withhold && (
          <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: 6, marginTop: "0.5rem" }}>
            <label>
              Betrag (Einbehalt)
              <input type="number" value={withholdAmount} onChange={e => setWithholdAmount(e.target.value)} required min="0" step="0.01" inputMode="decimal" />
            </label>
            <label>
              Beschreibung (Einbehalt)
              <input type="text" value={withholdDescription} onChange={e => setWithholdDescription(e.target.value)} required />
            </label>
            <label>
              Haushaltsplan
              <select
                className="form-select form-select-max"
                value={budgetPlanId}
                onChange={e => setBudgetPlanId(e.target.value)}
                required
                style={{ maxWidth: "220px" }}
              >
                <option value="">Bitte wählen</option>
                {budgetPlans.map(bp => (
                  <option key={bp.id} value={bp.id}>{bp.name}</option>
                ))}
              </select>
            </label>
            <label>
              Kostenstelle
              <select
                className="form-select form-select-max"
                value={costCenterId}
                onChange={e => setCostCenterId(e.target.value)}
                required
                disabled={!budgetPlanId}
                style={{ maxWidth: "220px" }}
              >
                <option value="">Bitte wählen</option>
                {costCenters.map(cc => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button type="submit" disabled={loading}>Erstatten</button>
      </form>
      {selected && (
        <p className="message" style={{ marginTop: "0.5rem" }}>
          Ausgewählt: {getAccountDisplayName(selected.account)}: {selected.description || "-"} ({selected.amount.toFixed(2)} €)
        </p>
      )}
      {message && <p className="message">{message}</p>}
    </div>
  );
}
