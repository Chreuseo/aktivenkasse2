"use client";

import React, { useCallback, useEffect, useState } from "react";
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

type RowState = {
  description: string;
  amount: string;
  clearingAccountId: string; // mutually exclusive with budgetPlanId
  budgetPlanId: string;
  costCenterId: string;
  file: File | null;
  reason: string;
  costCenters: { id: number; name: string }[];
};

export default function AllAdvancesClient() {
  const { data: session } = useSession();
  const [items, setItems] = useState<AdvanceListItem[] | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("open");
  const [clearingAccountId, setClearingAccountId] = useState<string>("");
  const [clearingOptions, setClearingOptions] = useState<{ id: number; name: string }[]>([]);
  const [budgetPlans, setBudgetPlans] = useState<any[]>([]);

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

  const loadBudgetPlans = useCallback(async () => {
    try {
      const token = extractToken(session);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/budget-plan", { headers });
      if (!res.ok) return setBudgetPlans([]);
      const json = await res.json();
      if (Array.isArray(json)) setBudgetPlans(json);
      else setBudgetPlans([]);
    } catch {
      setBudgetPlans([]);
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
        user: a.user || undefined,
        canCancel: false,
        receiptUrl: a.receiptUrl || undefined,
      }));
      setItems(norm);

      // initialize per-row state
      const rs: Record<number, RowState> = {};
      for (const it of norm) {
        rs[it.id] = {
          description: it.description || "",
          amount: typeof it.amount === 'string' ? it.amount : String(it.amount || ""),
          clearingAccountId: it.clearingAccount ? String(it.clearingAccount.id) : "",
          budgetPlanId: "",
          costCenterId: "",
          file: null,
          reason: "",
          costCenters: [],
        };
      }
      setRows(rs);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
      setItems([]);
      setRows({});
    } finally {
      setLoading(false);
    }
  }, [session, status, clearingAccountId]);

  useEffect(() => {
    if (session) {
      void loadClearingAccounts();
      void loadBudgetPlans();
      void load();
    }
  }, [session, loadClearingAccounts, loadBudgetPlans, load]);

  const fetchCostCentersForRow = async (rowId: number, planId: string) => {
    if (!planId) return;
    try {
      const token = extractToken(session);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/budget-plan/cost-centers?planId=${planId}`, { headers });
      if (!res.ok) {
        setRows(prev => ({ ...prev, [rowId]: { ...(prev[rowId]!), costCenters: [], costCenterId: "" } }));
        return;
      }
      const json = await res.json();
      setRows(prev => ({ ...prev, [rowId]: { ...(prev[rowId]!), costCenters: json || [], costCenterId: "" } }));
    } catch {
      setRows(prev => ({ ...prev, [rowId]: { ...(prev[rowId]!), costCenters: [], costCenterId: "" } }));
    }
  };

  const handleRowChange = (id: number, field: keyof RowState, value: any) => {
    setRows(prev => ({ ...(prev), [id]: { ...(prev[id]!), [field]: value } }));
  };

  const uploadAttachment = async (file: File | null) => {
    if (!file) return null;
    try {
      const token = extractToken(session);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/attachments', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: fd });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.id || null;
    } catch {
      return null;
    }
  };

  const handleAccept = async (it: AdvanceListItem) => {
    const row = rows[it.id];
    if (!row) return;
    setLoading(true);
    setError(null);
    try {
      let attachmentId = it.attachmentId || null;
      if (row.file) {
        const aid = await uploadAttachment(row.file);
        if (aid) attachmentId = aid;
      }
      const body: any = {
        id: it.id,
        description: row.description,
        reason: row.reason || undefined,
      };
      // amount override (try to parse)
      if (row.amount) {
        const as = String(row.amount).replace(',', '.');
        const an = Number(as);
        if (isFinite(an)) body.amount = as;
      }
      if (attachmentId) body.attachmentId = attachmentId;
      if (row.clearingAccountId) {
        body.clearingAccountId = Number(row.clearingAccountId);
      } else if (row.costCenterId) {
        body.costCenterId = Number(row.costCenterId);
      }

      const token = extractToken(session);
      const res = await fetch('/api/advances/handle/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Fehler beim Annehmen');
      } else {
        // refresh list
        await load();
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async (it: AdvanceListItem) => {
    const row = rows[it.id];
    if (!row) return;
    if (!row.reason || row.reason.trim() === '') {
      setError('Begründung ist erforderlich');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // allow updating some fields on decline as well
      const body: any = { id: it.id, reason: row.reason };
      if (row.description) body.description = row.description;
      if (row.amount) body.amount = String(row.amount).replace(',', '.');
      if (row.clearingAccountId) body.clearingAccountId = Number(row.clearingAccountId);
      if (row.costCenterId) body.costCenterId = Number(row.costCenterId);
      if (row.file) {
        const aid = await uploadAttachment(row.file);
        if (aid) body.attachmentId = aid;
      }
      const token = extractToken(session);
      const res = await fetch('/api/advances/handle/decline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Fehler beim Ablehnen');
      } else {
        await load();
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
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
              <th>Verrechnungskonto</th>
              <th>Budgetplan</th>
              <th>Status</th>
              <th>Bearbeiter</th>
            </tr>
            <tr>
              <th></th>
              <th>Betrag</th>
              <th>Beleg</th>
              <th>Kostenstelle</th>
              <th>Begründung</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#888" }}>Keine Auslagen gefunden.</td>
              </tr>
            ) : (
              items.map((it) => {
                const row = rows[it.id];
                return (
                  // two rows per item
                  <React.Fragment key={it.id}>
                    <tr key={`${it.id}-top`} className="kc-row">
                      <td>{new Date(it.date_advance).toLocaleDateString("de-DE")}</td>
                      <td>
                        <input type="text" value={row?.description || ''} onChange={(e) => handleRowChange(it.id, 'description', e.target.value)} />
                      </td>
                      <td>
                        <select value={row?.clearingAccountId || ''} onChange={(e) => {
                          const v = e.target.value;
                          handleRowChange(it.id, 'clearingAccountId', v);
                          if (v) {
                            handleRowChange(it.id, 'budgetPlanId', '');
                            handleRowChange(it.id, 'costCenterId', '');
                          }
                        }}>
                          <option value="">— Keines —</option>
                          {clearingOptions.map(c => (
                            <option key={c.id} value={String(c.id)}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={row?.budgetPlanId || ''} onChange={(e) => {
                          const v = e.target.value;
                          handleRowChange(it.id, 'budgetPlanId', v);
                          if (v) {
                            handleRowChange(it.id, 'clearingAccountId', '');
                            void fetchCostCentersForRow(it.id, v);
                          } else {
                            handleRowChange(it.id, 'costCenterId', '');
                            handleRowChange(it.id, 'costCenters', []);
                          }
                        }} disabled={!!(row?.clearingAccountId)}>
                          <option value="">— Keiner —</option>
                          {budgetPlans.map(bp => (
                            <option key={bp.id} value={String(bp.id)}>{bp.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`kc-badge ${it.state === "open" ? "new" : it.state === "cancelled" ? "changed" : "same"}`}>
                          {advanceStateLabel(it.state)}
                        </span>
                      </td>
                      <td>{it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : "—"}</td>
                    </tr>

                    <tr key={`${it.id}-bottom`} className="kc-row kc-entry-end">
                      <td>{it.user || "—"}</td>
                      <td>
                        <input type="text" value={row?.amount || ''} onChange={(e) => handleRowChange(it.id, 'amount', e.target.value)} style={{ width: 120 }} />
                      </td>
                      <td>
                        {it.receiptUrl ? (
                          <a className="button" href={it.receiptUrl} target="_blank" rel="noopener noreferrer">Beleg herunterladen</a>
                        ) : (
                          <input type="file" onChange={(e) => handleRowChange(it.id, 'file', e.target.files?.[0] || null)} accept="image/*,application/pdf" />
                        )}
                      </td>
                      <td>
                        <select value={row?.costCenterId || ''} onChange={(e) => handleRowChange(it.id, 'costCenterId', e.target.value)} disabled={!row?.budgetPlanId}>
                          <option value="">— Keine —</option>
                          {row?.costCenters?.map(cc => (
                            <option key={cc.id} value={String(cc.id)}>{cc.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="text" value={row?.reason || ''} onChange={(e) => handleRowChange(it.id, 'reason', e.target.value)} />
                      </td>
                      <td>
                        <button className="button" title="Annehmen" onClick={() => void handleAccept(it)} disabled={loading || it.state !== 'open'} hidden={loading || it.state !== 'open'}>✔</button>
                        <button className="button" title="Ablehnen" onClick={() => void handleDecline(it)} disabled={loading || it.state !== 'open'} hidden={loading || it.state !== 'open'} style={{ marginLeft: 6 }}>✖</button>
                      </td>
                    </tr>
                  </React.Fragment>
                 );
               })
             )}
           </tbody>
         </table>
       )}
    </div>
  );
}
