"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";
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
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setPlan(planRes);
        const ccRes = await fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setCostCenters(ccRes);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [planId, session]);

  const sortedCostCenters = getSortedCostCenters(plan, costCenters);
  const isClosed = plan?.state === 'closed';

  async function handleRecalculate() {
    if (!plan || isClosed) return;
    setRecalculating(true);
    setError(null);
    try {
      const token = extractToken(session);
      // Recalculate für den gesamten Budget-Plan in einem Aufruf
      await fetchJson(`/api/budget-plan/${planId}/recalculate`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      // Nach Abschluss neu laden
      const ccRes = await fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      setCostCenters(ccRes);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
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
    <div className="kc-page kc-page--wide">
      <h2 className="kc-page-title">Haushaltsplan Details</h2>
      {plan && (
        <div className="kc-infobox u-mb-3">
          <div className="kc-infobox-title">{plan.name}</div>
          <div className="kc-infobox-subtitle">{plan.description}</div>
          <div>Erstellt: {new Date(plan.createdAt).toLocaleDateString("de-DE")}</div>
          <div>Zuletzt geändert: {new Date(plan.updatedAt).toLocaleDateString("de-DE")}</div>
          <div>Status: {statusNames[plan.state] ?? plan.state}</div>
        </div>
      )}
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      <div className="kc-actions">
        <button className="button" onClick={handleRecalculate} disabled={isClosed || recalculating || loading || !costCenters.length}>
          {recalculating ? "Berechne ..." : "Neu berechnen"}
        </button>
      </div>
      <div className="wide-container">
        <table className="kc-table" role="table">
          <thead>
            <tr>
              <th className="kc-cell--sep">Name</th>
              <th>Plan-Soll Erträge (€)</th>
              <th>Plan-Soll Aufwendungen (€)</th>
              <th className="kc-cell--sep">Plan-Saldo (€)</th>
              <th>Ist-Erträge (€)</th>
              <th>Ist-Aufwendungen (€)</th>
              <th className="kc-cell--sep">Ist-Saldo (€)</th>
              <th>Abweichung Plan-Ist (€)</th>
            </tr>
          </thead>
          <tbody>
            {sortedCostCenters.map(cc => (
              <tr key={cc.id} className="kc-row">
                <td className="kc-cell--sep">{cc.name}</td>
                <td>{Number(cc.earnings_expected).toFixed(2)}</td>
                <td>{Number(cc.costs_expected).toFixed(2)}</td>
                <td className="kc-cell--sep">{(Number(cc.earnings_expected) - Number(cc.costs_expected)).toFixed(2)}</td>
                <td>{Number(cc.earnings_actual ?? 0).toFixed(2)}</td>
                <td>{Number(cc.costs_actual ?? 0).toFixed(2)}</td>
                <td className="kc-cell--sep">{(Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)).toFixed(2)}</td>
                <td>{((Number(cc.earnings_actual ?? 0) - Number(cc.costs_actual ?? 0)) - (Number(cc.earnings_expected) - Number(cc.costs_expected))).toFixed(2)}</td>
              </tr>
            ))}
            {sortedCostCenters.length === 0 && !loading && (
              <tr><td colSpan={8} className="kc-cell--center kc-cell--muted">Keine Kostenstellen gefunden</td></tr>
            )}
            {/* Summenzeile */}
            {sortedCostCenters.length > 0 && (
              <tr className="kc-sum-row">
                <td className="kc-cell--sep">Summe</td>
                <td>{sumEarningsExpected.toFixed(2)}</td>
                <td>{sumCostsExpected.toFixed(2)}</td>
                <td className="kc-cell--sep">{sumPlannedResult.toFixed(2)}</td>
                <td>{sumEarningsActual.toFixed(2)}</td>
                <td>{sumCostsActual.toFixed(2)}</td>
                <td className="kc-cell--sep">{sumActualResult.toFixed(2)}</td>
                <td>{sumDeviation.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="u-mt-3">
        <Link href="/budget-plan">
          <button className="button">Zurück zur Übersicht</button>
        </Link>
      </div>
    </div>
  );
}
