"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import "../../css/forms.css";
import "../../css/tables.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";

const bulkTypes = [
  { value: "einzug", label: "Einzug" },
  { value: "einzahlung", label: "Einzahlung" },
  { value: "auszahlung", label: "Auszahlung" },
];
const accountTypes = [
  { value: "user", label: "Nutzer" },
  { value: "bank", label: "Bankkonto" },
  { value: "clearing_account", label: "Verrechnungskonto" },
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
  const [formData, setFormData] = useState({
    date_valued: "",
    description: "",
    reference: "",
    bulkType: "einzug",
    accountType: "clearing_account",
    accountId: "",
    attachment: null as File | null,
  });
  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
  const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);
  const [rows, setRows] = useState([
    { type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" },
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
    fetchJson("/api/budget-plan", { headers }).then(setBudgetPlans).catch(() => setBudgetPlans([]));
  }, [session]);

  useEffect(() => {
    if (!formData.date_valued) {
      const today = new Date().toISOString().slice(0, 10);
      setFormData(prev => ({ ...prev, date_valued: today }));
    }
  }, [formData.date_valued]);

  // Auswahltyp-Logik je nach bulkType
  useEffect(() => {
    if (formData.bulkType === "einzahlung") {
      setFormData(prev => ({ ...prev, accountType: "bank" }));
    } else {
      setFormData(prev => ({ ...prev, accountType: "clearing_account" }));
    }
  }, [formData.bulkType]);

  // Handler
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, attachment: e.target.files?.[0] || null }));
  };
  const handleRowChange = (idx: number, field: string, value: string) => {
    setRows(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      let newRow = { ...row, [field]: value } as any;
      // Wenn Budgetplan geändert, Kostenstelle zurücksetzen
      if (field === "budgetPlanId") newRow.costCenterId = "";
      return newRow;
    }));
    // Kostenstellen für Budgetplan laden
    if (field === "budgetPlanId" && value) {
      const token = extractToken(session);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      fetchJson(`/api/budget-plan/cost-centers?planId=${value}`, { headers })
        .then(costCenters => setCostCentersByPlan(prev => ({ ...prev, [value]: costCenters })))
        .catch(() => setCostCentersByPlan(prev => ({ ...prev, [value]: [] })));
    }
  };
  const addRow = () => {
    setRows(prev => [...prev, { type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" }]);
  };
  const removeRow = () => {
    if (rows.length > 1) setRows(prev => prev.slice(0, -1));
  };

  // Auswahltyp-Optionen für Einzelbuchungen
  const rowAccountTypes = [
    { value: "user", label: "Nutzer" },
    { value: "clearing_account", label: "Verrechnungskonto" },
  ];

  // Absenden
  const handleSubmit = async () => {
    setMessage("");
    setLoading(true);
    try {
      // Jede Zeile validieren: wenn keine Auswahl (id leer), dann Budgetplan & Kostenstelle Pflicht
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.id) {
          if (!r.budgetPlanId || !r.costCenterId) {
            setMessage(`❌ Zeile ${i + 1}: Kostenstelle ist Pflicht ohne Auswahl (Budgetplan und Kostenstelle angeben)`);
            setLoading(false);
            return;
          }
        }
        // Betrag positiv prüfen
        const amt = Number(r.amount);
        if (!isFinite(amt) || amt <= 0) {
          setMessage(`❌ Zeile ${i + 1}: Ungültiger Betrag`);
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
      formDataObj.append("accountType", formData.accountType);
      formDataObj.append("accountId", formData.accountId);
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
        setMessage("✅ Sammeltransaktion erfolgreich angelegt!");
        setFormData({
          date_valued: new Date().toISOString().slice(0, 10),
          description: "",
          reference: "",
          bulkType: "einzug",
          accountType: "clearing_account",
          accountId: "",
          attachment: null,
        });
        setRows([{ type: "user", id: "", amount: "", description: "", budgetPlanId: "", costCenterId: "" }]);
      }
    } catch (error: any) {
      setMessage("❌ " + (error?.message || "Serverfehler"));
    } finally {
      setLoading(false);
    }
  };

  // Auswahloptionen für das Hauptkonto
  let mainAccountOptions: any[] = [];
  if (formData.accountType === "user") mainAccountOptions = userOptions;
  if (formData.accountType === "bank") mainAccountOptions = bankOptions;
  if (formData.accountType === "clearing_account") mainAccountOptions = clearingOptions;

  return (
    <div className="wide-container">
      <h1>Sammeltransaktion anlegen</h1>
      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} className="form">
        <div className="form-container">
          <label>
          Wertstellung
          <input
            type="date"
            name="date_valued"
            value={formData.date_valued}
            onChange={handleChange}
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
            disabled={formData.bulkType === "einzahlung"}
          >
            {accountTypes.filter(opt => {
              if (formData.bulkType === "einzahlung") return opt.value === "bank";
              if (["einzug", "auszahlung"].includes(formData.bulkType)) return ["user", "clearing_account"].includes(opt.value);
              return true;
            }).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
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
            {mainAccountOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
            ))}
          </select>
        </label>
        <label>
          Beleg
          <input
            type="file"
            className="form-file-upload"
            onChange={handleFileChange}
            accept="image/*,application/pdf"
          />
        </label>
      </div>
        <div className="form-table-wrapper">
          <table className="kc-table compact">
            <thead>
              <tr>
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
                  <td>
                    <select
                      className="kc-select"
                      value={row.type}
                      onChange={e => handleRowChange(idx, "type", e.target.value)}
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
                    >
                      <option value="">---</option>
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
                      min="0"
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
                      disabled={!!row.id}
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
                      disabled={!!row.id || !row.budgetPlanId}
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
