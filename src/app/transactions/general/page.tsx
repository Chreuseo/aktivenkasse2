'use client';

import React, { useEffect, useMemo, useState } from "react";
import "@/app/css/tables.css";
import { Transaction } from "@/app/types/transaction";
import GeneralTransactionTable from "@/app/components/GeneralTransactionTable";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";
import type { BudgetPlan } from "@/app/types/budgetPlan";
import type { CostCenter } from "@/app/types/costCenter";

export default function GeneralTransactionsPage() {
  const { data: session } = useSession();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filter-States
  const [plans, setPlans] = useState<BudgetPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<number | null>(null);
  const [loadingCostCenters, setLoadingCostCenters] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      setFilterError(null);
      try {
        const token = extractToken(session as any);
        // Transaktionen und Budgetpläne parallel laden
        const [txRes, plansRes] = await Promise.all([
          fetch('/api/transactions/general', {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: 'no-store',
          }),
          fetch('/api/budget-plan', {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: 'no-store',
          })
        ]);

        const [txJson, plansJson] = await Promise.all([txRes.json(), plansRes.json()]);
        if (!txRes.ok) throw new Error(txJson?.error || `${txRes.status} ${txRes.statusText}`);
        // Budgetpläne-Fehler nicht blockierend, aber anzeigen
        if (!plansRes.ok) {
          setFilterError(plansJson?.error || `${plansRes.status} ${plansRes.statusText}`);
          setPlans([]);
        } else {
          // Nur aktive/geschlossene Pläne für den Filter
          const usablePlans = (plansJson as BudgetPlan[]).filter(p => p.state === 'active' || p.state === 'closed');
          setPlans(usablePlans);
        }
        setTransactions(txJson as Transaction[]);
      } catch (e: any) {
        setError(e?.message || String(e));
        setTransactions(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  // Kostenstellen nachladen, wenn Budgetplan ausgewählt wird
  useEffect(() => {
    async function loadCostCenters(planId: number) {
      setLoadingCostCenters(true);
      setFilterError(null);
      try {
        const token = extractToken(session as any);
        const res = await fetch(`/api/budget-plan/cost-centers?planId=${planId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
        setCostCenters(json as CostCenter[]);
      } catch (e: any) {
        setFilterError(e?.message || String(e));
        setCostCenters([]);
      } finally {
        setLoadingCostCenters(false);
      }
    }

    if (selectedPlanId) {
      loadCostCenters(selectedPlanId);
      // Kostenstelle-Selection zurücksetzen
      setSelectedCostCenterId(null);
    } else {
      setCostCenters([]);
      setSelectedCostCenterId(null);
    }
  }, [selectedPlanId, session]);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [] as Transaction[];
    let list = transactions;
    if (selectedPlanId) {
      list = list.filter(tx => tx.budgetPlanId === selectedPlanId);
    }
    if (selectedCostCenterId) {
      list = list.filter(tx => tx.costCenterId === selectedCostCenterId);
    }
    return list;
  }, [transactions, selectedPlanId, selectedCostCenterId]);

  if (loading) {
    return <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem", color: 'var(--muted)' }}>Lade Daten ...</div>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
        <h2 style={{ marginBottom: "1rem" }}>Alle Buchungen ohne Gegenkonto (Bankkonten nicht negiert)</h2>
        <p>Fehler beim Laden: {error}</p>
      </div>
    );
  }

  if (!transactions) {
    return (
      <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem", color: 'var(--muted)' }}>
        Keine Daten
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Alle Buchungen ohne Gegenkonto (Bankkonten nicht negiert)</h2>

      {/* Filterleiste */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="planFilter" style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Budgetplan</label>
          <select
            id="planFilter"
            className="input"
            value={selectedPlanId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedPlanId(val ? Number(val) : null);
            }}
            style={{ minWidth: 240 }}
          >
            <option value="">Alle</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="ccFilter" style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Kostenstelle</label>
          <select
            id="ccFilter"
            className="input"
            value={selectedCostCenterId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedCostCenterId(val ? Number(val) : null);
            }}
            disabled={!selectedPlanId || loadingCostCenters || costCenters.length === 0}
            style={{ minWidth: 280 }}
          >
            <option value="">Alle</option>
            {costCenters.map(cc => (
              <option key={cc.id} value={cc.id}>{cc.name}</option>
            ))}
          </select>
        </div>

        {loadingCostCenters && <span style={{ color: 'var(--muted)' }}>Kostenstellen werden geladen ...</span>}
        {filterError && <span style={{ color: 'var(--accent)' }}>{filterError}</span>}
      </div>

      <GeneralTransactionTable transactions={filteredTransactions} />
    </div>
  );
}
