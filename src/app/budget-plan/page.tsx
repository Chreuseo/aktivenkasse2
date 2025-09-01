'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/app/lib/utils";
import Link from "next/link";
import type { BudgetPlan } from "./utils";
import { statusNames } from "@/app/types/budgetPlanStatusName";

export default function BudgetPlanOverview() {
  const { data: session } = useSession();
  const [plans, setPlans] = useState<BudgetPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const json = await fetchJson("/api/budget-plan", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        setPlans(json);
      } catch (e: any) {
        setError(e?.message || String(e));
        setPlans([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 16 }}>Haushaltsübersicht</h2>
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Erstellt</th>
            <th>Bearbeitet</th>
            <th>Status</th>
            <th>Bearbeiten</th>
            <th>Kostenstellen</th>
              <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {plans.map(plan => (
            <tr key={plan.id} className="kc-row">
              <td>{plan.name}</td>
              <td>{new Date(plan.createdAt).toLocaleDateString("de-DE")}</td>
              <td>{new Date(plan.updatedAt).toLocaleDateString("de-DE")}</td>
              <td>{statusNames[plan.state] ?? plan.state}</td>
              <td>
                <Link href={`/budget-plan/${plan.id}/edit`}>
                  <button className="button">
                    Bearbeiten
                  </button>
                </Link>
              </td>
              <td>
                <Link href={`/budget-plan/cost-centers/?planId=${plan.id}`}>
                  <button className="button">Kostenstellen</button>
                </Link>
              </td>
                <td>
                  <Link href={`/budget-plan/${plan.id}/details`}>
                    <button className="button">
                      Details
                    </button>
                  </Link>
                </td>
            </tr>
          ))}
          {plans.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Haushaltspläne gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
