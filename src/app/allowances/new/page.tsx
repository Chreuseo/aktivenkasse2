"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";

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

function sortUsersAlpha(users: User[]): User[] {
  return [...users].sort((a, b) => {
    const al = `${a.last_name ?? ''}`.trim();
    const bl = `${b.last_name ?? ''}`.trim();
    const c1 = al.localeCompare(bl, 'de', { sensitivity: 'base' });
    if (c1 !== 0) return c1;
    const af = `${a.first_name ?? ''}`.trim();
    const bf = `${b.first_name ?? ''}`.trim();
    return af.localeCompare(bf, 'de', { sensitivity: 'base' });
  });
}

function sortByNameAlpha<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'de', { sensitivity: 'base', numeric: true }));
}

export default function NewAllowancePage() {
  const { data: session } = useSession();
  const [formData, setFormData] = useState({
    type: "user",
    accountId: "",
    description: "",
    amount: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
  const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);

  useEffect(() => {
    const token = extractToken(session);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetchJson("/api/users", { headers })
      .then((u) => setUserOptions(sortUsersAlpha(u)))
      .catch(() => setUserOptions([]));
    fetchJson("/api/bank-accounts", { headers })
      .then((b) => setBankOptions(sortByNameAlpha(b)))
      .catch(() => setBankOptions([]));
    fetchJson("/api/clearing-accounts", { headers })
      .then((c) => setClearingOptions(sortByNameAlpha(c)))
      .catch(() => setClearingOptions([]));
  }, [session]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const token = extractToken(session);
      const body = {
        type: formData.type,
        accountId: Number(formData.accountId),
        description: formData.description,
        amount: Math.abs(Number(formData.amount)),
      };
      const res = await fetch("/api/allowances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = "❌ Fehler beim Anlegen.";
        if (result?.error) msg += `\n${result.error}`;
        if (result?.detail) msg += `\n${result.detail}`;
        setMessage(msg);
      } else {
        setMessage("✅ Rückstellung erfolgreich angelegt!");
        setFormData({ type: "user", accountId: "", description: "", amount: "" });
      }
    } catch (err: any) {
      setMessage("❌ " + (err?.message || "Serverfehler"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1>Neue Rückstellung anlegen</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Typ
          <select
            name="type"
            className="form-select form-select-max kc-max-220"
            value={formData.type}
            onChange={handleChange}
          >
            {accountTypes.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
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
            {getOptions(formData.type, userOptions, bankOptions, clearingOptions).map(opt => (
              <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
            ))}
          </select>
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
          Betrag
          <input
            type="number"
            name="amount"
            value={formData.amount}
            onChange={handleChange}
            required
            min="0"
            step="0.01"
            inputMode="decimal"
          />
        </label>
        <button type="submit" disabled={loading}>Anlegen</button>
      </form>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
