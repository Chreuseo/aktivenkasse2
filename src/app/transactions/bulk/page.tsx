"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import "../../css/forms.css";
import "../../css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";
import AttachmentHint from "@/app/components/AttachmentHint";

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
  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
  const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);
  const [rows, setRows] = useState([
    { date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" },
  ]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [budgetPlans, setBudgetPlans] = useState<any[]>([]);
  const [costCentersByPlan, setCostCentersByPlan] = useState<Record<string, any[]>>({});

  useEffect(() => {
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetchJson("/api/users", { headers }).then(setUserOptions).catch(() => setUserOptions([]));
    fetchJson("/api/bank-accounts", { headers }).then(setBankOptions).catch(() => setBankOptions([]));
    fetchJson("/api/clearing-accounts", { headers }).then(setClearingOptions).catch(() => setClearingOptions([]));
    fetchJson("/api/budget-plan", { headers }).then(list => setBudgetPlans(Array.isArray(list) ? list.filter((p: any) => p?.state === 'active') : [])).catch(() => setBudgetPlans([]));
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
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };
  const addRow = () => {
    setRows(prev => [...prev, { date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" }]);
  };
  const removeRow = () => {
    if (rows.length > 1) setRows(prev => prev.slice(0, -1));
  };

  const rowAccountTypes = [
    { value: "user", label: "Nutzer" },
    { value: "clearing_account", label: "Verrechnungskonto" },
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

      const token = extractToken(session);
      const formDataObj = new FormData();
      formDataObj.append("date_valued", formData.date_valued);
      formDataObj.append("description", formData.description);
      formDataObj.append("reference", formData.reference);
      formDataObj.append("bulkType", formData.bulkType);
      // Flag mitgeben, damit Route gezielt reagieren kann
      formDataObj.append("individualDates", String(individualDates));

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
      formDataObj.append("rows", JSON.stringify(rows));

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
        setRows([{ date: "", type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" }]);
      }
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Serverfehler"));
    } finally {
      setLoading(false);
    }
  };

  const globalCostCenters = formData.globalBudgetPlanId ? (costCentersByPlan[formData.globalBudgetPlanId] || []) : [];

  return (
    <div className="kc-page">
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
                />
          </label>
        <label>
          Beschreibung
          <input
            type="text"
            name="description"
            value={formData.description}
            onChange={handleChange}
            required
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
            className="form-select form-select-max"
            value={formData.bulkType}
            onChange={handleChange}
            style={{ maxWidth: "220px" }}
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
            className="form-select form-select-max"
            value={formData.accountType}
            onChange={handleChange}
            style={{ maxWidth: "220px" }}
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
              className="form-select form-select-max"
              value={formData.accountId}
              onChange={handleChange}
              required
              style={{ maxWidth: "220px" }}
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
                className="form-select form-select-max"
                value={formData.globalBudgetPlanId}
                onChange={handleChange}
                required
                style={{ maxWidth: "220px" }}
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
                className="form-select form-select-max"
                value={formData.globalCostCenterId}
                onChange={handleChange}
                required
                style={{ maxWidth: "220px" }}
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

      </div>
        <div className="form-table-wrapper">
          <table className="kc-table compact">
            <thead>
              <tr>
                <th hidden={!individualDates}>Datum einzeln</th>
                <th>Typ</th>
                <th>Auswahl</th>
                <th>Betrag</th>
                <th>Beschreibung</th>
                <th>Budgetplan</th>
                <th>Kostenstelle</th>
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
                      onChange={e => handleRowChange(idx, "type", e.target.value)}
                      required
                    >
                      {rowAccountTypes.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="kc-select"
                      value={row.id}
                      onChange={e => handleRowChange(idx, "id", e.target.value)}
                      // required entfernt: Pflicht nur, falls keine Kostenstelle
                    >
                      <option value="">Bitte wählen</option>
                      {getOptions(row.type, userOptions, [], clearingOptions).map(opt => (
                        <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="kc-input"
                      value={row.amount}
                      onChange={e => handleRowChange(idx, "amount", e.target.value)}
                      // Bei Kontobewegung sind auch negative Werte erlaubt
                      min={formData.bulkType === 'einzahlung' ? undefined : "0"}
                      step="0.01"
                      inputMode="decimal"
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="kc-input"
                      value={row.description}
                      onChange={e => handleRowChange(idx, "description", e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className="kc-select"
                      value={row.budgetPlanId || ""}
                      onChange={e => handleRowChange(idx, "budgetPlanId", e.target.value)}
                      disabled={formData.accountType === 'cost_center' || !!row.id}
                    >
                      <option value="">Kein Budgetplan</option>
                      {budgetPlans.map(bp => (
                        <option key={bp.id} value={bp.id}>{bp.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="kc-select"
                      value={row.costCenterId || ""}
                      onChange={e => handleRowChange(idx, "costCenterId", e.target.value)}
                      disabled={formData.accountType === 'cost_center' || !!row.id || !row.budgetPlanId}
                    >
                      <option value="">Bitte wählen</option>
                      {(row.budgetPlanId && costCentersByPlan[row.budgetPlanId] ? costCentersByPlan[row.budgetPlanId] : []).map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.name}</option>
                      ))}
                    </select>
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
      </form>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
