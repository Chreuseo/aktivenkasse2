"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";
import "../css/tables.css";
import "../css/forms.css";
import type { AdvanceListItem, AdvanceState } from "@/app/types/advance";
import { advanceStateLabel } from "@/app/types/advance";
import AttachmentHint from "@/app/components/AttachmentHint";

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
  isDonation: boolean;
  donationType: 'material' | 'waive_fees';
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
      if (Array.isArray(json)) setBudgetPlans(json.filter((p: any) => p?.state === "active"));
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
        if (clearingAccountId === 'none') {
          // Nur Auslagen ohne Verrechnungskonto
          url = "/api/advances/all";
          params.set("clearing", "none");
        } else {
          // request per clearing-account endpoint
          url = "/api/advances/cost-center";
          params.set("clearingAccountId", clearingAccountId);
        }
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
        reason: a.reason || undefined,
        is_donation: !!a.is_donation,
        donationType: a.donationType || null,
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
          reason: it.reason || "",
          costCenters: [],
          isDonation: !!(it as any).is_donation,
          donationType: ((it as any).donationType === 'waive_fees' ? 'waive_fees' : 'material'),
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
    setRows(prev => {
      const next = { ...(prev), [id]: { ...(prev[id]!), [field]: value } };
      const row = next[id]!;

      // Regel: wenn Spende, dann weder Verrechnungskonto noch Budget/Kostenstelle
      if (field === 'isDonation' && value === true) {
        row.clearingAccountId = '';
        row.budgetPlanId = '';
        row.costCenterId = '';
        row.costCenters = [];
      }

      return next;
    });
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
        is_donation: row.isDonation,
        donationType: row.isDonation ? row.donationType : null,
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
    <div className="kc-page table-center">
      <h1 className="kc-page-title">Auslagenübersicht</h1>
      {error && <p className="kc-error">Fehler: {error}</p>}

      <div className="kc-filter-grid u-mb-3">
        <div className="kc-filter-subgrid">
          <div className="kc-label-col">
            <label>Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="kc-label-col">
            <label>Verrechnungskonto</label>
            <select className="form-select form-select-max" value={clearingAccountId} onChange={(e) => setClearingAccountId(e.target.value)}>
              <option value="">— Alle —</option>
              <option value="none">— Verrechnungskonto —</option>
              {clearingOptions.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="u-mt-2">
          <button className="button" onClick={() => void load()} disabled={loading}>Aktualisieren</button>
        </div>
      </div>

      {loading && <p className="kc-status">Lade…</p>}

      {!loading && items && (
        <div className="advances-list" aria-label="Auslagen">
          {items.length === 0 ? (
            <div className="kc-cell--center kc-cell--muted u-mb-3">Keine Auslagen gefunden.</div>
          ) : (
            items.map((it) => {
              const row = rows[it.id];
              const isDonation = !!((it as any).is_donation);
              const dt = ((it as any).donationType === 'waive_fees' ? 'waive_fees' : 'material');
              const donationLabel = dt === 'waive_fees' ? 'Verzichtsspende' : 'Sachspende';

              return (
                <div key={it.id} className="advance-card">
                  <div className="advance-grid">
                    <div className="advance-field">
                      <div className="advance-label">Datum</div>
                      <div>{new Date(it.date_advance).toLocaleDateString("de-DE")}</div>
                    </div>

                    <div className="advance-field advance-field--wide">
                      <div className="advance-label">Beschreibung</div>
                      <input
                        type="text"
                        value={row?.description || ''}
                        onChange={(e) => handleRowChange(it.id, 'description', e.target.value)}
                      />
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Status</div>
                      <span className={`kc-badge ${it.state === "open" ? "new" : it.state === "cancelled" ? "changed" : "same"}`}>
                        {advanceStateLabel(it.state)}
                      </span>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Bearbeiter</div>
                      <div>{it.reviewer ? `${it.reviewer.first_name} ${it.reviewer.last_name}` : "—"}</div>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Einreicher</div>
                      <div>{it.user || "—"}</div>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Betrag</div>
                      <input
                        type="text"
                        value={row?.amount || ''}
                        onChange={(e) => handleRowChange(it.id, 'amount', e.target.value)}
                        className="kc-max-140"
                      />
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Spende</div>
                      <div className="kc-checkline">
                        <input type="checkbox" checked={isDonation} disabled />
                        {isDonation ? <span className="kc-muted-dash">{donationLabel}</span> : <span className="kc-muted-dash">—</span>}
                      </div>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Art</div>
                      <select defaultValue={dt} disabled={!isDonation} aria-label="Spendenart">
                        <option value="material">Sachspende</option>
                        <option value="waive_fees">Verzichtsspende</option>
                      </select>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Verrechnungskonto</div>
                      <select
                        value={row?.clearingAccountId || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          handleRowChange(it.id, 'clearingAccountId', v);
                          if (v) {
                            handleRowChange(it.id, 'budgetPlanId', '');
                            handleRowChange(it.id, 'costCenterId', '');
                          }
                        }}
                        disabled={isDonation}
                        title={isDonation ? 'Bei Spende sind Verrechnungskonto/Kostenstelle nicht erlaubt' : undefined}
                      >
                        <option value="">— Verrechnungskonto —</option>
                        {clearingOptions.map(c => (
                          <option key={c.id} value={String(c.id)}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Budgetplan</div>
                      <select
                        value={row?.budgetPlanId || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          handleRowChange(it.id, 'budgetPlanId', v);
                          if (v) {
                            handleRowChange(it.id, 'clearingAccountId', '');
                            void fetchCostCentersForRow(it.id, v);
                          } else {
                            handleRowChange(it.id, 'costCenterId', '');
                            handleRowChange(it.id, 'costCenters', []);
                          }
                        }}
                        disabled={isDonation || !!(row?.clearingAccountId)}
                        title={isDonation ? 'Bei Spende sind Verrechnungskonto/Kostenstelle nicht erlaubt' : undefined}
                      >
                        <option value="">— Haushaltsplan —</option>
                        {budgetPlans.map(bp => (
                          <option key={bp.id} value={String(bp.id)}>{bp.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Kostenstelle</div>
                      <select
                        value={row?.costCenterId || ''}
                        onChange={(e) => handleRowChange(it.id, 'costCenterId', e.target.value)}
                        disabled={isDonation || !row?.budgetPlanId}
                        title={isDonation ? 'Bei Spende sind Verrechnungskonto/Kostenstelle nicht erlaubt' : undefined}
                      >
                        <option value="">— Kostenstelle —</option>
                        {row?.costCenters?.map(cc => (
                          <option key={cc.id} value={String(cc.id)}>{cc.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="advance-field">
                      <div className="advance-label">Beleg</div>
                      {it.receiptUrl ? (
                        <a
                          href={it.receiptUrl.startsWith('/') ? it.receiptUrl : `/api/advances/${it.id}/receipt`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <button className="button kc-btn--compact" type="button">
                            Beleg herunterladen
                          </button>
                        </a>
                      ) : (
                        <div>
                          <input
                            type="file"
                            className="form-file-upload"
                            onChange={(e) => handleRowChange(it.id, 'file', e.target.files?.[0] || null)}
                            accept="image/*,application/pdf"
                            disabled={loading}
                          />
                          <AttachmentHint file={row?.file} />
                        </div>
                      )}
                    </div>

                    <div className="advance-field advance-field--wide">
                      <div className="advance-label">Begründung</div>
                      <input
                        type="text"
                        value={row?.reason || ''}
                        onChange={(e) => handleRowChange(it.id, 'reason', e.target.value)}
                        disabled={loading || it.state !== 'open'}
                        placeholder="Pflicht bei Ablehnung"
                      />
                    </div>

                    <div className="advance-field advance-actions">
                      <div className="advance-label">Aktion</div>
                      <div>
                        <button className="button" title="Annehmen" onClick={() => void handleAccept(it)} disabled={loading || it.state !== 'open'}>✔</button>
                        <button className="button u-ml-2" title="Ablehnen" onClick={() => void handleDecline(it)} disabled={loading || it.state !== 'open'}>✖</button>
                      </div>
                    </div>
                  </div>

                  {/* dicke Trennlinie zwischen Einträgen */}
                  <div className="advance-divider" />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
