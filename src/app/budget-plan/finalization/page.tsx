"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { extractToken, fetchJson } from "@/lib/utils";
import { statusNames } from "@/app/types/budgetPlanStatusName";
import { getSortedCostCenters } from "@/app/budget-plan/utils";
import type { BudgetPlan } from "@/app/types/budgetPlan";
import type { CostCenter } from "@/app/types/costCenter";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import "@/app/css/forms.css";

export default function BudgetPlanFinalizationPage() {
  const { data: session } = useSession();
  const [plans, setPlans] = useState<BudgetPlan[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [closing, setClosing] = useState(false);

  // Simple Rechenaufgabe
  const [a, setA] = useState<number>(() => Math.floor(10 + Math.random() * 40));
  const [b, setB] = useState<number>(() => Math.floor(1 + Math.random() * 9));
  const [answer, setAnswer] = useState("");

  const challengeOk = useMemo(() => {
    const n = Number(answer);
    return !Number.isNaN(n) && n === a + b;
  }, [answer, a, b]);

  useEffect(() => {
    async function loadOpenPlans() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        // Nur aktive Pläne laden – Drafts sind nicht finalisierbar
        const all = await fetchJson(`/api/budget-plan?state=active`, {
          method: "GET",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        const openPlans: BudgetPlan[] = (all || []);
        setPlans(openPlans);
        if (openPlans.length && selectedId == null) {
          setSelectedId(openPlans[0].id);
        } else if (!openPlans.length) {
          setSelectedId(null);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    loadOpenPlans();
  }, [session]);

  // Plan + Kostenstellen laden, wenn Auswahl wechselt
  useEffect(() => {
    if (!selectedId) {
      setPlan(null);
      setCostCenters([]);
      return;
    }
    async function loadPlan() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const p = await fetchJson(`/api/budget-plan/${selectedId}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        const cc = await fetchJson(`/api/budget-plan/cost-centers?planId=${selectedId}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setPlan(p);
        setCostCenters(cc || []);
        // Neue Aufgabe generieren und Antwort leeren
        setA(Math.floor(10 + Math.random() * 40));
        setB(Math.floor(1 + Math.random() * 9));
        setAnswer("");
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, [selectedId, session]);

  const sortedCostCenters = useMemo(() => getSortedCostCenters(plan, costCenters), [plan, costCenters]);

  async function handleRecalculate() {
    if (!selectedId || !plan) return;
    setRecalculating(true);
    setError(null);
    try {
      const token = extractToken(session);
      await fetchJson(`/api/budget-plan/${selectedId}/recalculate`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      const cc = await fetchJson(`/api/budget-plan/cost-centers?planId=${selectedId}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      setCostCenters(cc || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRecalculating(false);
    }
  }

  async function handleFinalize() {
    if (!selectedId || !plan || !challengeOk) return;
    setClosing(true);
    setError(null);
    try {
      const token = extractToken(session);
      await fetchJson(`/api/budget-plan/${selectedId}/finalize`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      // Erfolgreich: Plan aus der Liste entfernen und Auswahl zurücksetzen
      const remaining = plans.filter((p) => p.id !== selectedId);
      setPlans(remaining);
      setSelectedId(remaining.length ? remaining[0].id : null);
      setPlan(null);
      setCostCenters([]);
      setAnswer("");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setClosing(false);
    }
  }

  // Summen berechnen
  const sumEarningsExpected = sortedCostCenters.reduce((sum, cc) => sum + Number(cc.earnings_expected), 0);
  const sumCostsExpected = sortedCostCenters.reduce((sum, cc) => sum + Number(cc.costs_expected), 0);
  const sumEarningsActual = sortedCostCenters.reduce((sum, cc) => sum + Number(cc.earnings_actual ?? 0), 0);
  const sumCostsActual = sortedCostCenters.reduce((sum, cc) => sum + Number(cc.costs_actual ?? 0), 0);
  const sumPlannedResult = sumEarningsExpected - sumCostsExpected;
  const sumActualResult = sumEarningsActual - sumCostsActual;
  const sumDeviation = sumActualResult - sumPlannedResult;

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Haushaltsabschluss</h2>

      <div className="form" style={{ marginBottom: "1rem" }}>
        <label>
          Haushalt auswählen
          <select
            className="form-select form-select-max"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            {plans.length === 0 && <option value="">Kein aktiver Haushalt vorhanden</option>}
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({statusNames[p.state] ?? p.state})
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}

      {plan && (
        <>
          <div className="kc-infobox" style={{ marginBottom: "1.2rem" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{plan.name}</div>
            <div style={{ color: "var(--muted)", marginBottom: 4 }}>{plan.description}</div>
            <div>Status: {statusNames[plan.state] ?? plan.state}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
            <button className="button" onClick={handleRecalculate} disabled={recalculating || loading || !costCenters.length}>
              {recalculating ? "Berechne ..." : "Neu berechnen"}
            </button>
          </div>

          <div className="wide-container" style={{ paddingTop: 0 }}>
            <table className="kc-table" role="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Einnahmen geplant (€)</th>
                  <th>Ausgaben geplant (€)</th>
                  <th>Ergebnis geplant (€)</th>
                  <th>Einnahmen real (€)</th>
                  <th>Ausgaben real (€)</th>
                  <th>Ergebnis real (€)</th>
                  <th>Abweichung Ergebnis (€)</th>
                </tr>
              </thead>
              <tbody>
                {sortedCostCenters.map((cc) => (
                  <tr key={cc.id} className="kc-row">
                    <td>{cc.name}</td>
                    <td>{Number(cc.earnings_expected).toFixed(2)}</td>
                    <td>{Number(cc.costs_expected).toFixed(2)}</td>
                    <td>{(Number(cc.earnings_expected) - Number(cc.costs_expected)).toFixed(2)}</td>
                    <td>{Number(cc.earnings_actual ?? 0).toFixed(2)}</td>
                    <td>{Number(cc.costs_actual ?? 0).toFixed(2)}</td>
                    <td>{(Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)).toFixed(2)}</td>
                    <td>
                      {(
                        (Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)) -
                        (Number(cc.earnings_expected) - Number(cc.costs_expected))
                      ).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {sortedCostCenters.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                      Keine Kostenstellen gefunden
                    </td>
                  </tr>
                )}
                {sortedCostCenters.length > 0 && (
                  <tr className="kc-sum-row">
                    <td>Summe</td>
                    <td>{sumEarningsExpected.toFixed(2)}</td>
                    <td>{sumCostsExpected.toFixed(2)}</td>
                    <td>{sumPlannedResult.toFixed(2)}</td>
                    <td>{sumEarningsActual.toFixed(2)}</td>
                    <td>{sumCostsActual.toFixed(2)}</td>
                    <td>{sumActualResult.toFixed(2)}</td>
                    <td>{sumDeviation.toFixed(2)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Sicherheitsabfrage */}
          <div className="form" style={{ marginTop: "1.2rem", gap: ".6rem" }}>
            <label>
              Sicherheitsabfrage: Wie viel ist {a} + {b}?
              <input
                className="form-input"
                type="number"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Ergebnis eingeben"
                style={{ maxWidth: 200 }}
              />
            </label>
            {!challengeOk && answer !== "" && (
              <div style={{ color: "var(--accent)" }}>Antwort ist nicht korrekt.</div>
            )}
          </div>

          <div style={{ display: "flex", gap: ".6rem", marginTop: "1rem" }}>
            <button
              className="button"
              onClick={() => {
                // neue Aufgabe, Antwort leeren
                setA(Math.floor(10 + Math.random() * 40));
                setB(Math.floor(1 + Math.random() * 9));
                setAnswer("");
              }}
              disabled={closing}
            >
              Neue Aufgabe
            </button>
            <button
              className="button"
              onClick={handleFinalize}
              disabled={!challengeOk || closing || recalculating || loading}
              title={!challengeOk ? "Bitte erst die Rechenaufgabe korrekt lösen" : "Haushalt abschließen"}
            >
              {closing ? "Schließe ..." : "Haushalt abschließen"}
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <Link href="/budget-plan">
          <button className="button">Zurück zur Übersicht</button>
        </Link>
      </div>
    </div>
  );
}
