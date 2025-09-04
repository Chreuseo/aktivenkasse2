"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
import type { ClearingAccount, Member } from "@/app/types/clearingAccount";
import type { BudgetPlan as BudgetPlanType } from "@/app/types/budgetPlan";
import "@/app/css/tables.css";
import "@/app/css/forms.css";

// Lokale Datentypen für UI-Zustand jeder Zeile
type RowState = {
  via: string; // "members" oder budgetPlanId als string
  budgetPlanId: string;
  costCenterId: string;
  amount: string; // Eingabefeld (p.P. bei members, sonst Gesamt)
  loading: boolean;
  message: string;
  costCenters: Array<{ id: number; name: string }>;
};

type UiClearing = ClearingAccount & { members: Member[] };

type BudgetPlan = { id: number; name: string; state?: string };

type PostPayload = {
  clearingAccountId: number;
  viaType: "members" | "budget";
  amount: number; // p.P. bei members, Gesamt bei budget
  budgetPlanId?: number;
  costCenterId?: number;
};

function roundAwayFromZeroCents(n: number): number {
  if (!isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const v = Math.ceil(Math.abs(n) * 100 - 1e-9) / 100;
  return sign * v;
}

export default function ClearingAccountsFunctionsPage() {
  const { data: session } = useSession();
  const token = useMemo(() => extractToken(session), [session]);
  const authHeaders: Record<string, string> = useMemo(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const [accounts, setAccounts] = useState<UiClearing[]>([]);
  const [plans, setPlans] = useState<BudgetPlan[]>([]);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [loadingAll, setLoadingAll] = useState(false);

  // Laden: Konten + aktive Budgetpläne
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingAll(true);
      try {
        const [accs, allPlans] = await Promise.all([
          fetchJson("/api/clearing-accounts/functions", { headers: authHeaders }),
          fetchJson("/api/budget-plan", { headers: authHeaders }),
        ]);
        if (cancelled) return;
        const plansArr = (Array.isArray(allPlans) ? (allPlans as BudgetPlanType[]) : [])
          .filter((p) => p?.state === "active")
          .map((p) => ({ id: p.id, name: p.name, state: p.state }));
        setPlans(plansArr);
        setAccounts(accs as UiClearing[]);
        // Initial RowStates
        const init: Record<number, RowState> = {};
        (accs as UiClearing[]).forEach((a) => {
          init[a.id] = {
            via: "", // keine Vorauswahl
            budgetPlanId: "",
            costCenterId: "",
            amount: "",
            loading: false,
            message: "",
            costCenters: [],
          };
        });
        setRows(init);
      } catch (e) {
        // Log optional
        console.error(e);
      } finally {
        setLoadingAll(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  // Planwechsel => Kostenstellen laden
  async function loadCostCentersForRow(id: number, planId: string) {
    if (!planId) {
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], costCenters: [], costCenterId: "" } }));
      return;
    }
    try {
      const list = await fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, { headers: authHeaders });
      const options = (list as Array<{ id: number; name: string }>).map((cc) => ({ id: cc.id, name: cc.name }));
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], costCenters: options, costCenterId: "" } }));
    } catch {
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], costCenters: [], costCenterId: "" } }));
    }
  }

  function onChangeVia(id: number, value: string, hasMembers: boolean) {
    // value kann "members" oder planId sein
    const next: Partial<RowState> = { message: "" };
    if (value === "members") {
      if (!hasMembers) return; // ignorieren, sollte gar nicht anwählbar sein
      next.via = "members";
      next.budgetPlanId = "";
      next.costCenterId = "";
      next.costCenters = [];
    } else {
      next.via = value; // speichere planId in via
      next.budgetPlanId = value;
      next.costCenterId = "";
      next.costCenters = [];
      loadCostCentersForRow(id, value);
    }
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }

  function onChangeCostCenter(id: number, ccId: string) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], costCenterId: ccId, message: "" } }));
  }

  function onChangeAmount(id: number, val: string) {
    // Plain string, parse bei Submit
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], amount: val, message: "" } }));
  }

  function setZeroAmount(id: number, acc: UiClearing) {
    const row = rows[id];
    if (!row) return;
    // Wenn Mitglieder gewählt: p.P. = Kontostand / Mitgliederanzahl
    if (row.via === "members") {
      const m = acc.members?.length || 0;
      if (m === 0) {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Keine Mitglieder vorhanden" } }));
        return;
      }
      const perPerson = roundAwayFromZeroCents((acc.balance || 0) / m);
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], amount: String(perPerson) } }));
      return;
    }
    // Wenn Budgetplan gewählt: Gesamtbetrag = Kontostand
    if (row.budgetPlanId) {
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], amount: String(acc.balance || 0) } }));
      return;
    }
    // sonst keine Auswahl
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Bitte zuerst 'Über' auswählen" } }));
  }

  async function submitRow(id: number, acc: UiClearing) {
    const row = rows[id];
    if (!row) return;

    // Validierung
    if (!row.via) {
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Bitte 'Über' auswählen" } }));
      return;
    }

    const amtNum = Number(row.amount);
    if (!isFinite(amtNum) || amtNum === 0) {
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Betrag muss ungleich 0 sein" } }));
      return;
    }

    const payload: PostPayload = {
      clearingAccountId: id,
      viaType: row.via === "members" ? "members" : "budget",
      amount: row.via === "members" ? roundAwayFromZeroCents(amtNum) : amtNum,
    };

    if (payload.viaType === "budget") {
      if (!row.budgetPlanId) {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Budgetplan auswählen" } }));
        return;
      }
      if (!row.costCenterId) {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Kostenstelle auswählen" } }));
        return;
      }
      payload.budgetPlanId = Number(row.budgetPlanId);
      payload.costCenterId = Number(row.costCenterId);
    } else {
      if ((acc.members?.length || 0) === 0) {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], message: "Keine Mitglieder vorhanden" } }));
        return;
      }
    }

    setRows((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, message: "" } }));
    try {
      const res = await fetch("/api/clearing-accounts/functions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], loading: false, message: `Fehler: ${(json as any)?.error || res.statusText}` } }));
        return;
      }
      // Erfolgreich: Tabelle aktualisieren (Balances neu laden)
      const fresh = await fetchJson("/api/clearing-accounts/functions", { headers: authHeaders });
      setAccounts(fresh as UiClearing[]);
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], loading: false, message: "Erfolgreich verbucht" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], loading: false, message: msg || "Unbekannter Fehler" } }));
    }
  }

  return (
    <div className="wide-container">
      <div style={{ width: "100%", maxWidth: 1600 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0" }}>
          <h2>Verrechnungskonten Funktionen</h2>
          <Link href="/clearing-accounts"><button className="button">Zur Übersicht</button></Link>
        </div>
        <table className="kc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Verantwortlicher</th>
              <th>Kontostand</th>
              <th>Erstattungsberechtigt</th>
              <th>Über</th>
              <th>Kostenstelle</th>
              <th>Nullsetzen</th>
              <th>Betrag p.P.</th>
              <th>Einziehen</th>
            </tr>
          </thead>
          <tbody>
            {loadingAll && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>Laden…</td></tr>
            )}
            {!loadingAll && accounts.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Verrechnungskonten vorhanden</td></tr>
            )}
            {accounts.map((acc) => {
              const row = (rows[acc.id] || { via: "", budgetPlanId: "", costCenterId: "", amount: "", loading: false, message: "", costCenters: [] }) as RowState;
              const hasMembers = (acc.members?.length || 0) > 0;
              const amountNum = Number(row.amount);
              const label = isFinite(amountNum) && amountNum < 0 ? "Einziehen" : "Auszahlen";
              const viaMembersSelected = row.via === "members";
              const viaBudgetSelected = !!row.budgetPlanId && row.via !== "members";
              return (
                <tr key={acc.id} className="kc-row">
                  <td>{acc.name}</td>
                  <td>{acc.responsible || <span style={{ color: "var(--muted)" }}>-</span>}</td>
                  <td style={{ fontWeight: 600, color: "var(--primary)" }}>{(acc.balance || 0).toFixed(2)} €</td>
                  <td>{acc.reimbursementEligible ? "Ja" : "Nein"}</td>
                  <td>
                    <select
                      className="form-select"
                      value={row.via}
                      onChange={(e) => onChangeVia(acc.id, e.target.value, hasMembers)}
                      style={{ minWidth: 180 }}
                    >
                      <option value="">Bitte wählen</option>
                      {hasMembers && <option value="members">Mitglieder</option>}
                      {plans.map((p) => (
                        <option key={p.id} value={String(p.id)}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      disabled={!viaBudgetSelected}
                      value={row.costCenterId}
                      onChange={(e) => onChangeCostCenter(acc.id, e.target.value)}
                      style={{ minWidth: 200 }}
                    >
                      <option value="">{viaBudgetSelected ? "Bitte wählen" : "—"}</option>
                      {row.costCenters.map((cc) => (
                        <option key={cc.id} value={String(cc.id)}>{cc.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="button" type="button" onClick={() => setZeroAmount(acc.id, acc)} disabled={!row.via || row.loading}>Nullsetzen</button>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => onChangeAmount(acc.id, e.target.value)}
                      className="kc-input"
                      placeholder={viaMembersSelected ? "Betrag p.P." : "Betrag"}
                      style={{ maxWidth: 140 }}
                      step="0.01"
                    />
                  </td>
                  <td>
                    <button
                      className="button"
                      disabled={row.loading || !row.via || !row.amount}
                      onClick={() => submitRow(acc.id, acc)}
                      title={label}
                    >
                      {label}
                    </button>
                    {row.message && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{row.message}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
