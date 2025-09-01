"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/app/lib/utils";
import Link from "next/link";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";

interface BudgetPlan {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  firstCostCenter?: number;
}

interface CostCenter {
  id: number;
  name: string;
  description?: string;
  earnings_expected: number;
  costs_expected: number;
  nextCostCenter?: number;
}

export default function CostCentersPage() {
  const searchParams = useSearchParams();
  const planId = searchParams?.get("planId");
  const { data: session } = useSession();
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<{[id: number]: Partial<CostCenter>}>({});
  const [newRows, setNewRows] = useState<Partial<CostCenter>[]>([]);
  const [saving, setSaving] = useState(false);

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

  function handleEdit(id: number, field: keyof CostCenter, value: any) {
    setEditRows(r => ({ ...r, [id]: { ...r[id], [field]: value } }));
  }

  function handleAddNewRow() {
    setNewRows(rows => [...rows, { name: "", earnings_expected: 0, costs_expected: 0 }]);
  }

  function handleNewRowChange(index: number, field: keyof CostCenter, value: any) {
    setNewRows(rows => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  function handleDeleteNewRow(index: number) {
    setNewRows(rows => rows.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = extractToken(session);
      // Update existing cost centers
      for (const id in editRows) {
        await fetchJson(`/api/budget-plan/cost-centers/${id}`, {
          method: "PUT",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editRows[+id]),
        });
      }
      // Add new cost centers
      let newIds: number[] = [];
      for (const row of newRows) {
        if (row.name && planId) {
          const res = await fetchJson(`/api/budget-plan/cost-centers`, {
            method: "POST",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...row, budget_planId: +planId }),
          });
          if (res?.id) newIds.push(res.id);
        }
      }
      // Verkettung und Reihenfolge setzen
      // Hole aktuelle Reihenfolge aus State
      let allCostCenters = [...sortedCostCenters];
      // Füge neue Kostenstellen hinten an
      if (newRows.length && newIds.length === newRows.length) {
        for (let i = 0; i < newRows.length; i++) {
          allCostCenters.push({
            id: newIds[i],
            name: newRows[i].name ?? "",
            earnings_expected: newRows[i].earnings_expected ?? 0,
            costs_expected: newRows[i].costs_expected ?? 0,
            nextCostCenter: undefined,
          });
        }
      }
      // Setze nextCostCenter für jede Kostenstelle
      for (let i = 0; i < allCostCenters.length; i++) {
        const cc = allCostCenters[i];
        const nextId = allCostCenters[i + 1]?.id ?? null;
        await fetchJson(`/api/budget-plan/cost-centers/${cc.id}`, {
          method: "PATCH",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nextCostCenter: nextId }),
        });
      }
      // Setze firstCostCenter im Haushaltsplan
      if (planId && allCostCenters.length) {
        await fetchJson(`/api/budget-plan/${planId}`, {
          method: "PATCH",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ firstCostCenter: allCostCenters[0].id }),
        });
      }
      // Update plan's updatedAt
      await fetchJson(`/api/budget-plan/${planId}`, {
        method: "PATCH",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ updatedAt: new Date().toISOString() }),
      });
      setEditRows({});
      setNewRows([]);
      // Reload
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
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setSaving(true);
    setError(null);
    try {
      const token = extractToken(session);
      await fetchJson(`/api/budget-plan/cost-centers/${id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      setEditRows(r => {
        const copy = { ...r };
        delete copy[id];
        return copy;
      });
      // Reload
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
      setSaving(false);
    }
  }

  function getSortedCostCenters(plan: BudgetPlan | null, costCenters: CostCenter[]): CostCenter[] {
    if (!plan || !costCenters.length) return costCenters;
    const map = new Map<number, CostCenter>();
    costCenters.forEach(cc => map.set(cc.id, cc));
    const sorted: CostCenter[] = [];
    let currentId = plan.firstCostCenter;
    let visited = new Set<number>();
    while (currentId && map.has(currentId) && !visited.has(currentId)) {
      const cc = map.get(currentId)!;
      sorted.push(cc);
      visited.add(currentId);
      currentId = cc.nextCostCenter;
    }
    // Füge alle nicht verketteten am Ende hinzu
    costCenters.forEach(cc => {
      if (!visited.has(cc.id)) sorted.push(cc);
    });
    return sorted;
  }

  const sortedCostCenters = getSortedCostCenters(plan, costCenters);

  const handleMoveUp = async (idx: number) => {
    if (idx === 0) return;
    await updateOrder(idx, idx - 1);
  };

  const handleMoveDown = async (idx: number) => {
    if (idx === sortedCostCenters.length - 1) return;
    await updateOrder(idx, idx + 1);
  };

  const updateOrder = (fromIdx: number, toIdx: number) => {
    const arr = [...sortedCostCenters];
    const moved = arr.splice(fromIdx, 1)[0];
    arr.splice(toIdx, 0, moved);
    // Verkettung aktualisieren
    for (let i = 0; i < arr.length; i++) {
      arr[i].nextCostCenter = arr[i + 1]?.id ?? null;
    }
    setCostCenters(arr);
    // firstCostCenter im Plan aktualisieren
    if (plan && arr.length > 0) {
      setPlan({ ...plan, firstCostCenter: arr[0].id });
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Kostenstellen verwalten</h2>
      {plan && (
        <div className="kc-infobox" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{plan.name}</div>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>{plan.description}</div>
          <div>Erstellt: {new Date(plan.createdAt).toLocaleDateString("de-DE")}</div>
          <div>Zuletzt geändert: {new Date(plan.updatedAt).toLocaleDateString("de-DE")}</div>
          <div>Status: {plan.state}</div>
        </div>
      )}
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Geplante Einnahmen (€)</th>
            <th>Geplante Ausgaben (€)</th>
            <th>Erwartetes Ergebnis (€)</th>
            <th>Sortierung</th>
            <th>Löschen</th>
          </tr>
        </thead>
        <tbody>
          {sortedCostCenters.map((cc, idx) => (
            <tr key={cc.id} className="kc-row">
              <td>
                <input type="text" className="kc-input" value={editRows[cc.id]?.name ?? cc.name} onChange={e => handleEdit(cc.id, "name", e.target.value)} />
              </td>
              <td>
                <input type="number" className="kc-input" value={editRows[cc.id]?.earnings_expected ?? cc.earnings_expected} onChange={e => handleEdit(cc.id, "earnings_expected", parseFloat(e.target.value))} />
              </td>
              <td>
                <input type="number" className="kc-input" value={editRows[cc.id]?.costs_expected ?? cc.costs_expected} onChange={e => handleEdit(cc.id, "costs_expected", parseFloat(e.target.value))} />
              </td>
              <td>
                {((editRows[cc.id]?.earnings_expected ?? cc.earnings_expected) - (editRows[cc.id]?.costs_expected ?? cc.costs_expected)).toFixed(2)} €
              </td>
              <td style={{ display: "flex", gap: "0.3rem" }}>
                <button className="button" onClick={() => handleMoveUp(idx)} disabled={idx === 0}>↑</button>
                <button className="button" onClick={() => handleMoveDown(idx)} disabled={idx === sortedCostCenters.length - 1}>↓</button>
              </td>
              <td>
                <button className="button" onClick={() => handleDelete(cc.id)}>Löschen</button>
              </td>
            </tr>
          ))}
          {newRows.map((row, idx) => (
            <tr key={"new-"+idx} className="kc-row">
              <td>
                <input type="text" className="kc-input" value={row.name ?? ""} onChange={e => handleNewRowChange(idx, "name", e.target.value)} placeholder="Neue Kostenstelle" />
              </td>
              <td>
                <input type="number" className="kc-input" value={row.earnings_expected ?? ""} onChange={e => handleNewRowChange(idx, "earnings_expected", parseFloat(e.target.value))} placeholder="Einnahmen" />
              </td>
              <td>
                <input type="number" className="kc-input" value={row.costs_expected ?? ""} onChange={e => handleNewRowChange(idx, "costs_expected", parseFloat(e.target.value))} placeholder="Ausgaben" />
              </td>
              <td>
                {((row.earnings_expected ?? 0) - (row.costs_expected ?? 0)).toFixed(2)} €
              </td>
              <td style={{ display: "flex", gap: "0.3rem" }}>
                <button className="button" disabled>↑</button>
                <button className="button" disabled>↓</button>
              </td>
              <td>
                <button className="button" onClick={() => handleDeleteNewRow(idx)} disabled={saving}>Löschen</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: "1rem", marginTop: "1.2rem" }}>
        <button className="button" onClick={handleAddNewRow} disabled={saving}>Zeile hinzufügen</button>
        <button className="button" onClick={handleSave} disabled={saving}>Speichern</button>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <Link href="/budget-plan">
          <button className="button">Zurück zur Übersicht</button>
        </Link>
      </div>
    </div>
  );
}
