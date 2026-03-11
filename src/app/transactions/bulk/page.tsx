"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useMemo, useRef } from "react";
import "../../css/forms.css";
import "../../css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";
import AttachmentHint from "@/app/components/AttachmentHint";
import {
  calcRowAmountCents,
  centsToAmountString,
  ensureQtyKeys,
  parsePriceToCents,
  type TickItem,
} from "@/lib/tickList";

const bulkTypes = [
  { value: "einzug", label: "Einzug" },
  { value: "einzahlung", label: "Kontobewegung" },
  { value: "auszahlung", label: "Auszahlung" },
];
const accountTypes = [
  { value: "user", label: "Nutzer" },
  { value: "bank", label: "Bankkonto" },
  { value: "clearing_account", label: "Verrechnungskonto" },
  { value: "cost_center", label: "Kostenstelle" },
];

function getOptions(type: string, userOptions: User[], bankOptions: BankAccount[], clearingOptions: ClearingAccount[]) {
  if (type === "user") return userOptions;
  if (type === "bank") return bankOptions;
  if (type === "clearing_account") return clearingOptions;
  return [];
}
function getAccountDisplayName(opt: any) {
  if (!opt) return "";
  if (opt.name) return opt.name;
  if (opt.first_name && opt.last_name) return `${opt.first_name} ${opt.last_name}`;
  if (opt.iban) return opt.iban;
  if (opt.mail) return opt.mail;
  return String(opt.id || "Unbekannt");
}

export default function BulkTransactionPage() {
  const { data: session } = useSession();
  // Datum einzeln Toggle (vorher konstant false)
  const [individualDates, setIndividualDates] = useState<boolean>(false);

  const [formData, setFormData] = useState({
    date_valued: "",
    description: "",
    reference: "",
    bulkType: "einzug",
    accountType: "clearing_account" as "user" | "bank" | "clearing_account" | "cost_center",
    accountId: "",
    globalBudgetPlanId: "",
    globalCostCenterId: "",
    attachment: null as File | null,
  });

  // Kontobewegung: Datum einzeln immer aktiv (State erzwingen)
  useEffect(() => {
    if (formData.bulkType === 'einzahlung' && !individualDates) {
      setIndividualDates(true);
    }
  }, [formData.bulkType, individualDates]);

  const [tickListMode, setTickListMode] = useState<boolean>(false);
  const [tickItems, setTickItems] = useState<TickItem[]>([{ id: crypto.randomUUID(), price: "" }]);


  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
  const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);
  const [rows, setRows] = useState([
    { date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "", qtyByItemId: {} as Record<string, number> },
  ]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [budgetPlans, setBudgetPlans] = useState<any[]>([]);
  const [costCentersByPlan, setCostCentersByPlan] = useState<Record<string, any[]>>({});

  // Dedupe für parallele CostCenter-Ladevorgänge
  const costCenterLoadInFlight = useRef<Record<string, Promise<any[]>>>({});

  // Kostenstellen für einen Plan laden (lazy + Cache)
  const loadCostCenters = async (planId: string) => {
    if (!planId) return [] as any[];

    // Cache hit
    if (costCentersByPlan[planId]) return costCentersByPlan[planId];

    // bereits laufenden Request wiederverwenden
    const inFlight = costCenterLoadInFlight.current[planId];
    if (inFlight) return inFlight;

    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const p = fetchJson(`/api/budget-plan/cost-centers?planId=${planId}`, { headers })
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        setCostCentersByPlan((prev) => ({ ...prev, [planId]: arr }));
        return arr;
      })
      .catch(() => {
        setCostCentersByPlan((prev) => ({ ...prev, [planId]: [] }));
        return [];
      })
      .finally(() => {
        delete costCenterLoadInFlight.current[planId];
      });

    costCenterLoadInFlight.current[planId] = p;
    return p;
  };

  // Zusatz: Filter-Lade-Box State
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [loadFilter, setLoadFilter] = useState<{ status: string; hv: "alle" | "ja" | "nein"; description: string; amount: string }>({
    status: "",
    hv: "alle",
    description: "",
    amount: "",
  });

  useEffect(() => {
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetchJson("/api/users", { headers }).then(setUserOptions).catch(() => setUserOptions([]));
    fetchJson("/api/bank-accounts", { headers }).then(setBankOptions).catch(() => setBankOptions([]));
    fetchJson("/api/clearing-accounts", { headers }).then(setClearingOptions).catch(() => setClearingOptions([]));
    fetchJson("/api/budget-plan", { headers }).then(list => setBudgetPlans(Array.isArray(list) ? list.filter((p: any) => p?.state === 'active') : [])).catch(() => setBudgetPlans([]));
    // Status-Optionen laden
    fetchJson("/api/users?action=statuses", { headers }).then((list: string[]) => setStatusOptions(Array.isArray(list) ? list : [])).catch(() => setStatusOptions([]));
  }, [session]);

  useEffect(() => {
    if (!formData.date_valued) {
      const today = new Date().toISOString().slice(0, 10);
      setFormData(prev => ({ ...prev, date_valued: today }));
    }
  }, [formData.date_valued]);

  // Wenn Toggle für individuelle Daten aktiviert wird, passe accountType je nach bulkType an
  useEffect(() => {
    setFormData(prev => {
      // Kontobewegung: nur Bank als Hauptkonto, individuelle Daten erlaubt
      if (prev.bulkType === 'einzahlung') {
        const next: any = { ...prev, accountType: 'bank' };
        // Bei Kontobewegung keine globale Kostenstelle
        next.globalBudgetPlanId = '';
        next.globalCostCenterId = '';
        return next;
      }
      // Einzug/Auszahlung: individuelle Daten nur im Kostenstellenmodus zulässig
      if (individualDates && ["einzug", "auszahlung"].includes(prev.bulkType)) {
        return { ...prev, accountType: 'cost_center', accountId: '', /* schalte auf Haushaltsplan-Auswahl */ };
      }
      return prev;
    });
  }, [individualDates, formData.bulkType]);

  // Bestehende Logik zum Setzen des accountType je nach bulkType beibehalten, aber berücksichtige individuellen Modus
  useEffect(() => {
    setFormData(prev => {
      if (prev.bulkType === 'einzahlung') {
        return { ...prev, accountType: 'bank', globalBudgetPlanId: '', globalCostCenterId: '' };
      }
      if (individualDates && ["einzug", "auszahlung"].includes(prev.bulkType)) {
        return { ...prev, accountType: 'cost_center', accountId: '' };
      }
      if (prev.accountType === 'bank') return { ...prev, accountType: 'clearing_account' };
      return prev;
    });
  }, [formData.bulkType]);

  useEffect(() => {
    if (formData.accountType === 'cost_center' && formData.globalBudgetPlanId) {
      const token = extractToken(session);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      fetchJson(`/api/budget-plan/cost-centers?planId=${formData.globalBudgetPlanId}`, { headers })
        .then(costCenters => setCostCentersByPlan(prev => ({ ...prev, [formData.globalBudgetPlanId]: costCenters })))
        .catch(() => setCostCentersByPlan(prev => ({ ...prev, [formData.globalBudgetPlanId]: [] })));
    }
  }, [formData.accountType, formData.globalBudgetPlanId, session]);

  useEffect(() => {
    if (formData.accountType === 'cost_center' && formData.globalBudgetPlanId && formData.globalCostCenterId) {
      setRows(prev => prev.map(r => ({
        ...r,
        budgetPlanId: "",
        costCenterId: "",
      })));
    }
  }, [formData.accountType, formData.globalBudgetPlanId, formData.globalCostCenterId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData(prev => ({ ...prev, attachment: file }));
  };
  // Handler: Änderung von Zeilenfeldern inkl. Datum
  const handleRowChange = (idx: number, field: string, value: any) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  // Spezial: Budgetplan in Zeile geändert => Kostenstellen nachladen + Auswahl zurücksetzen
  const handleRowBudgetPlanChange = async (idx: number, planId: string) => {
    // erst UI-State updaten, damit Dropdown sofort reagiert
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              budgetPlanId: planId,
              costCenterId: "",
            }
          : r,
      ),
    );

    if (!planId) return;
    await loadCostCenters(planId);
  };

  // Spezial: Typ in Zeile geändert.
  // Wenn nicht Kostenstelle: Budgetplan/Kostenstelle leeren.
  const handleRowTypeChange = (idx: number, type: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next: any = { ...r, type };
        if (type !== "cost_center") {
          next.budgetPlanId = "";
          next.costCenterId = "";
        }
        return next;
      }),
    );
  };

  const handleQtyChange = (rowIdx: number, itemId: string, value: string) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const parsed = value === "" ? "" : String(Math.max(0, Math.trunc(Number(value))));
      return {
        ...r,
        qtyByItemId: {
          ...((r as any).qtyByItemId ?? {}),
          [itemId]: parsed,
        },
      };
    }));
  };

  const addTickItem = () => {
    const newItem: TickItem = { id: crypto.randomUUID(), price: "" };
    setTickItems(prev => [...prev, newItem]);
    setRows(prev => prev.map(r => ({
      ...r,
      qtyByItemId: { ...((r as any).qtyByItemId ?? {}), [newItem.id]: 0 },
    })));
  };

  const removeTickItem = (itemId: string) => {
    setTickItems(prev => prev.filter(i => i.id !== itemId));
    setRows(prev => prev.map(r => {
      const next = { ...((r as any).qtyByItemId ?? {}) };
      delete (next as any)[itemId];
      return { ...r, qtyByItemId: next };
    }));
  };

  const updateTickItemPrice = (itemId: string, price: string) => {
    setTickItems(prev => prev.map(i => i.id === itemId ? { ...i, price } : i));
  };

  const addRow = () => {
    setRows(prev => [...prev, { date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "", qtyByItemId: Object.fromEntries(tickItems.map(i => [i.id, 0])) as Record<string, number> }]);
  };
  const removeRow = () => {
    if (rows.length > 1) setRows(prev => prev.slice(0, -1));
  };
  const removeRowAt = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const rowAccountTypes = [
    { value: "user", label: "Nutzer" },
    { value: "clearing_account", label: "Verrechnungskonto" },
    { value: "cost_center", label: "Kostenstelle" },
  ];

  const handleSubmit = async () => {
    setMessage("");
    setLoading(true);
    try {
      // Validierung je Modus
      if (formData.accountType === 'cost_center') {
        if (!formData.globalBudgetPlanId || !formData.globalCostCenterId) {
          setMessage('❌ Bitte Haushaltsplan und Kostenstelle oben auswählen.');
          setLoading(false);
          return;
        }
      } else {
        if (!formData.accountId) {
          setMessage('❌ Bitte ein Hauptkonto in der Auswahl wählen.');
          setLoading(false);
          return;
        }
      }

      if (tickListMode) {
        if (!tickItems.length) {
          setMessage('❌ Bitte mindestens eine Einzelpreis-Spalte anlegen.');
          setLoading(false);
          return;
        }
        const invalid = tickItems.find(i => parsePriceToCents(i.price) === null);
        if (invalid) {
          setMessage('❌ Bitte alle Einzelpreise im Tabellenkopf befüllen (größer 0).');
          setLoading(false);
          return;
        }
      }

      const token = extractToken(session);
      const formDataObj = new FormData();
      formDataObj.append("date_valued", formData.date_valued);
      formDataObj.append("description", formData.description);
      formDataObj.append("reference", formData.reference);
      formDataObj.append("bulkType", formData.bulkType);
      // Flag mitgeben, damit Route gezielt reagieren kann
      formDataObj.append("individualDates", String(formData.bulkType === 'einzahlung' ? true : individualDates));

      if (formData.accountType === 'cost_center') {
        formDataObj.append("globalBudgetPlanId", formData.globalBudgetPlanId);
        formDataObj.append("globalCostCenterId", formData.globalCostCenterId);
      } else {
        formDataObj.append("accountType", formData.accountType);
        formDataObj.append("accountId", formData.accountId);
      }

      if (formData.attachment) {
        formDataObj.append("attachment", formData.attachment);
      }

      const rowsForSubmit = tickListMode
        ? (rows.map((r, idx) => ({ ...r, amount: computedAmountByRowIndex[idx] ?? "0.00" })) as any)
        : rows;

      formDataObj.append("rows", JSON.stringify(rowsForSubmit));

      const res = await fetch("/api/transactions/bulk", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formDataObj,
      });
      let result;
      try {
        result = await res.json();
      } catch {
        result = {};
      }
      if (!res.ok) {
        let msg = "❌ Fehler beim Speichern.";
        if (result?.error) msg += `\n${result.error}`;
        setMessage(msg);
      } else {
        setMessage("✅ Transaktion(en) erfolgreich angelegt!");
        setFormData({
          date_valued: new Date().toISOString().slice(0, 10),
          description: "",
          reference: "",
          bulkType: "einzug",
          accountType: "clearing_account",
          accountId: "",
          globalBudgetPlanId: "",
          globalCostCenterId: "",
          attachment: null,
        });
        setTickListMode(false);
        setTickItems([{ id: crypto.randomUUID(), price: "" }]);
        setRows([{ date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "", qtyByItemId: {} as Record<string, number> }]);
      }
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Serverfehler"));
    } finally {
      setLoading(false);
    }
  };

  const globalCostCenters = formData.globalBudgetPlanId ? (costCentersByPlan[formData.globalBudgetPlanId] || []) : [];

  // Nutzer anhand Filter laden und Zeilen auffüllen (nur Client-seitig, kein Absenden)
  const handleLoadTemplate = async () => {
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const params = new URLSearchParams();
    if (loadFilter.status) params.set('status', loadFilter.status);
    if (loadFilter.hv) params.set('hv', loadFilter.hv);
    try {
      const users: any[] = await fetchJson(`/api/users?${params.toString()}`, { headers });
      // Entferne eine letzte leere Zeile, falls vorhanden
      setRows(prev => {
        let base = prev;
        if (base.length && !base[base.length - 1].id && !base[base.length - 1].amount && !base[base.length - 1].description) {
          base = base.slice(0, -1);
        }
        const appended = users.map(u => ({
          date: individualDates ? formData.date_valued : "",
          type: "user",
          id: String(u.id),
          amount: tickListMode ? "" : (loadFilter.amount || ""),
          description: loadFilter.description || "",
          budgetPlanId: "",
          costCenterId: "",
          qtyByItemId: Object.fromEntries(tickItems.map(i => [i.id, 0])) as Record<string, number>,
        }));
        return [...base, ...appended];
      });
    } catch (err: any) {
      setMessage("❌ Fehler beim Laden der Nutzer: " + (err?.message || 'Unbekannt'));
    }
  };

  const computedAmountByRowIndex = useMemo(() => {
    if (!tickListMode) return [] as string[];
    return rows.map(r => centsToAmountString(calcRowAmountCents(r as any, tickItems)));
  }, [rows, tickItems, tickListMode]);

  useEffect(() => {
    // Beim Umschalten in den Strichtlistenmodus: stelle sicher, dass alle Zeilen alle Item-Keys haben.
    if (!tickListMode) return;
    setRows(prev => ensureQtyKeys(prev as any, tickItems) as any);
  }, [tickListMode, tickItems]);

  return (
    <div className="kc-page table-center">
      <h1>Sammeltransaktion anlegen</h1>
      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} className="form">
        <div className="form-container">
          <label>
          Datum
          <input
            type="date"
            name="date_valued"
            value={formData.date_valued}
            onChange={handleChange}
            disabled={individualDates}
          />
        </label>
          <label>
            Datum einzeln
            <input
              type="checkbox"
                name="individualDates"
                checked={individualDates || false}
                onChange={e => setIndividualDates(e.target.checked)}
                disabled={formData.bulkType === 'einzahlung'}
                />
          </label>
        <label>
          Beschreibung
          <input
            type="text"
            name="description"
            value={formData.description}
            onChange={handleChange}
            required={formData.bulkType !== 'einzahlung'}
            disabled={formData.bulkType === 'einzahlung'}
          />
        </label>
        <label>
          Referenz
          <input
            type="text"
            name="reference"
            value={formData.reference}
            onChange={handleChange}
          />
        </label>
        <label>
          Einzugsart
          <select
            name="bulkType"
            className="form-select form-select-max kc-max-220"
            value={formData.bulkType}
            onChange={handleChange}
          >
            {bulkTypes.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label>
          Auswahltyp
          <select
            name="accountType"
            className="form-select form-select-max kc-max-220"
            value={formData.accountType}
            onChange={handleChange}
          >
            {accountTypes.filter(opt => {
              if (formData.bulkType === "einzahlung") return ["bank"].includes(opt.value);
              if (["einzug", "auszahlung"].includes(formData.bulkType)) return ["user", "clearing_account", "cost_center"].includes(opt.value);
              return true;
            }).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        {formData.accountType !== 'cost_center' ? (
          <label>
            Auswahl
            <select
              name="accountId"
              className="form-select form-select-max kc-max-220"
              value={formData.accountId}
              onChange={handleChange}
              required
            >
              <option value="">Bitte wählen</option>
              {getOptions(formData.accountType, userOptions, bankOptions, clearingOptions).map(opt => (
                <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Auswahl (Haushaltsplan)
              <select
                name="globalBudgetPlanId"
                className="form-select form-select-max kc-max-220"
                value={formData.globalBudgetPlanId}
                onChange={handleChange}
                required
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
                name="globalCostCenterId"
                className="form-select form-select-max kc-max-220"
                value={formData.globalCostCenterId}
                onChange={handleChange}
                required
                disabled={!formData.globalBudgetPlanId}
              >
                <option value="">Bitte wählen</option>
                {globalCostCenters.map(cc => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <label>
          Anhang
          <input
            type="file"
            className="form-file-upload"
            onChange={handleFileChange}
            accept="image/*,application/pdf"
          />
        </label>
        <AttachmentHint file={formData.attachment} />

        <label>
          Strichtlistenmodus
          <input
            type="checkbox"
            name="tickListMode"
            checked={tickListMode || false}
            onChange={e => setTickListMode(e.target.checked)}
          />
        </label>

      </div>
        <div className="form-table-wrapper">
          <table className="kc-table compact">
            <thead>
              <tr>
                <th hidden={!individualDates}>Datum einzeln</th>
                <th>Typ</th>
                <th>Auswahl</th>
                <th>Kostenstelle</th>
                <th>Betrag</th>
                {tickListMode && (
                  <>
                    {tickItems.map((item, idx) => (
                      <th key={item.id} className="kc-th--min-140">
                        <div className="kc-head-controls">
                          <input
                            type="number"
                            className="kc-input kc-w-110"
                            value={item.price}
                            onChange={e => updateTickItemPrice(item.id, e.target.value)}
                            placeholder={`Einzelpreis ${idx + 1}`}
                            step="0.01"
                            inputMode="decimal"
                            required
                          />
                          <button
                            type="button"
                            className="form-btn form-btn-danger kc-px-8"
                            onClick={() => removeTickItem(item.id)}
                            disabled={tickItems.length === 1}
                            title="Spalte entfernen"
                          >
                            −
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="kc-th--w-60">
                      <button type="button" className="form-btn form-btn-secondary" onClick={addTickItem} title="Spalte hinzufügen">+</button>
                    </th>
                  </>
                )}
                <th>Beschreibung</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td hidden={!individualDates}>
                    <input
                      type="date"
                      className="kc-input"
                      value={row.date || formData.date_valued}
                      onChange={e => handleRowChange(idx, "date", e.target.value)}
                      disabled={!individualDates}
                    />
                  </td>
                  <td>
                    <select
                      className="kc-select"
                      value={row.type}
                      onChange={e => handleRowTypeChange(idx, e.target.value)}
                      required
                    >
                      {rowAccountTypes.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.type === "cost_center" ? (
                      <select
                        className="kc-select"
                        value={row.budgetPlanId || ""}
                        onChange={e => handleRowBudgetPlanChange(idx, e.target.value)}
                        disabled={formData.accountType === 'cost_center'}
                      >
                        <option value="">Haushalt wählen</option>
                        {budgetPlans.map(bp => (
                          <option key={bp.id} value={bp.id}>{bp.name}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="kc-select"
                        value={row.id}
                        onChange={e => handleRowChange(idx, "id", e.target.value)}
                      >
                        <option value="">Bitte wählen</option>
                        {getOptions(row.type, userOptions, [], clearingOptions).map(opt => (
                          <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <select
                      className="kc-select"
                      value={row.costCenterId || ""}
                      onChange={e => handleRowChange(idx, "costCenterId", e.target.value)}
                      disabled={row.type !== "cost_center" || formData.accountType === 'cost_center' || !row.budgetPlanId}
                    >
                      <option value="">Bitte wählen</option>
                      {(row.budgetPlanId && costCentersByPlan[row.budgetPlanId] ? costCentersByPlan[row.budgetPlanId] : []).map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="kc-input"
                      value={tickListMode ? (computedAmountByRowIndex[idx] ?? "0.00") : row.amount}
                      onChange={e => handleRowChange(idx, "amount", e.target.value)}
                      min={formData.bulkType === 'einzahlung' ? undefined : "0"}
                      step="0.01"
                      inputMode="decimal"
                      required
                      disabled={tickListMode}
                    />
                  </td>

                  {tickListMode && (
                    <>
                      {tickItems.map(item => {
                        const qtyRaw = (row as any).qtyByItemId?.[item.id];
                        const qtyValue = qtyRaw === undefined ? "" : String(qtyRaw);
                        return (
                          <td key={item.id}>
                            <input
                              type="number"
                              className="kc-input kc-w-110"
                              value={qtyValue}
                              onChange={e => handleQtyChange(idx, item.id, e.target.value)}
                              min={0}
                              step={1}
                              inputMode="numeric"
                              placeholder="0"
                            />
                          </td>
                        );
                      })}
                      <td />
                    </>
                  )}

                  <td>
                    <input
                      type="text"
                      className="kc-input"
                      value={row.description}
                      onChange={e => handleRowChange(idx, "description", e.target.value)}
                      required={formData.bulkType === 'einzahlung'}
                    />
                  </td>
                  <td className="kc-cell--num">
                    <button type="button" className="form-btn form-btn-danger" onClick={() => removeRowAt(idx)}>x</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-table-buttons">
          <button type="button" className="form-btn form-btn-secondary" onClick={addRow}>Zeile hinzufügen</button>
          <button type="button" className="form-btn form-btn-danger" onClick={removeRow} disabled={rows.length === 1}>Zeile löschen</button>
          <button type="submit" className="form-btn form-btn-primary" disabled={loading}>Absenden</button>
        </div>

        {/* Zusatzbox zum Vorlagenladen */}
        <div className="form-container kc-section kc-section--light">
          <h3>Vorlage laden</h3>
          <label>
            Status
            <select
              className="form-select form-select-max kc-max-220"
              value={loadFilter.status}
              onChange={e => setLoadFilter(prev => ({ ...prev, status: e.target.value }))}
            >
              <option value="">Alle</option>
              {statusOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Hausvereinsmitglied
            <select
              className="form-select form-select-max kc-max-220"
              value={loadFilter.hv}
              onChange={e => setLoadFilter(prev => ({ ...prev, hv: e.target.value as any }))}
            >
              <option value="alle">Alle</option>
              <option value="ja">Ja</option>
              <option value="nein">Nein</option>
            </select>
          </label>
          <label>
            Beschreibung
            <input
              type="text"
              className="kc-input"
              value={loadFilter.description}
              onChange={e => setLoadFilter(prev => ({ ...prev, description: e.target.value }))}
            />
          </label>
          <label>
            Betrag
            <input
              type="number"
              className="kc-input"
              value={loadFilter.amount}
              onChange={e => setLoadFilter(prev => ({ ...prev, amount: e.target.value }))}
              step="0.01"
              inputMode="decimal"
            />
          </label>
          <div>
            <button type="button" className="form-btn form-btn-secondary" onClick={handleLoadTemplate}>Laden</button>
          </div>
        </div>
      </form>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
