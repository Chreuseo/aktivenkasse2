"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/app/lib/utils";
import Link from "next/link";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import type { BudgetPlan } from "@/app/types/budgetPlan";
import type { CostCenter } from "@/app/types/costCenter";
import { getSortedCostCenters } from "../../utils";
import { statusNames } from "@/app/types/budgetPlanStatusName";

export default function BudgetPlanDetailsPage() {
  const params = useParams();
  const planId = params?.id;
  const { data: session } = useSession();
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (!planId) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const planRes = await fetchJson(`/api/budget-plan/${planId}`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setPlan(planRes);
        const ccRes = await fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setCostCenters(ccRes);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [planId, session]);

  const sortedCostCenters = getSortedCostCenters(plan, costCenters);

  async function handleRecalculate() {
    if (!plan || !costCenters.length) return;
    setRecalculating(true);
    setError(null);
    try {
      const token = extractToken(session);
      // Für jede Kostenstelle recalculation ausführen
      for (const cc of costCenters) {
        await fetchJson(`/api/budget-plan/cost-centers/${cc.id}/recalculate`, {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
      }
      // Nach Abschluss neu laden
      const ccRes = await fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      setCostCenters(ccRes);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRecalculating(false);
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
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Haushaltsplan Details</h2>
      {plan && (
        <div className="kc-infobox" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{plan.name}</div>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>{plan.description}</div>
          <div>Erstellt: {new Date(plan.createdAt).toLocaleDateString("de-DE")}</div>
          <div>Zuletzt geändert: {new Date(plan.updatedAt).toLocaleDateString("de-DE")}</div>
          <div>Status: {statusNames[plan.state] ?? plan.state}</div>
        </div>
      )}
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button className="button" onClick={handleRecalculate} disabled={recalculating || loading || !costCenters.length}>
          {recalculating ? "Berechne ..." : "Neu berechnen"}
        </button>
      </div>
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
          {sortedCostCenters.map(cc => (
            <tr key={cc.id} className="kc-row">
              <td>{cc.name}</td>
              <td>{Number(cc.earnings_expected).toFixed(2)}</td>
              <td>{Number(cc.costs_expected).toFixed(2)}</td>
              <td>{(Number(cc.earnings_expected) - Number(cc.costs_expected)).toFixed(2)}</td>
              <td>{Number(cc.earnings_actual ?? 0).toFixed(2)}</td>
              <td>{Number(cc.costs_actual ?? 0).toFixed(2)}</td>
              <td>{(Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)).toFixed(2)}</td>
              <td>{((Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)) - (Number(cc.earnings_expected) - Number(cc.costs_expected))).toFixed(2)}</td>
            </tr>
          ))}
          {sortedCostCenters.length === 0 && !loading && (
            <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Kostenstellen gefunden</td></tr>
          )}
          {/* Summenzeile */}
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
      <div style={{ marginTop: "1rem" }}>
        <Link href="/budget-plan">
          <button className="button">Zurück zur Übersicht</button>
        </Link>
      </div>
    </div>
  );
}
