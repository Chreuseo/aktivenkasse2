"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";

type UserOption = { id: number; first_name: string; last_name: string; mail: string };
type ClearingOption = { id: number; name: string };
type BankOption = { id: number; name: string; bank: string };

function sortUsersAlpha(users: UserOption[]): UserOption[] {
  return [...users].sort((a, b) => {
    const al = `${a.last_name ?? ""}`.trim();
    const bl = `${b.last_name ?? ""}`.trim();
    const c1 = al.localeCompare(bl, "de", { sensitivity: "base" });
    if (c1 !== 0) return c1;
    const af = `${a.first_name ?? ""}`.trim();
    const bf = `${b.first_name ?? ""}`.trim();
    return af.localeCompare(bf, "de", { sensitivity: "base" });
  });
}

function sortByNameAlpha<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "de", { sensitivity: "base", numeric: true }));
}

export default function RecalculateProcessPage() {
  const { data: session } = useSession();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [clearingAccounts, setClearingAccounts] = useState<ClearingOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankOption[]>([]);

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedClearingId, setSelectedClearingId] = useState<string>("");
  const [selectedBankId, setSelectedBankId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [accountErrors, setAccountErrors] = useState<Array<{ accountId: number; soll: string; ist: string }> | null>(null);
  const [result, setResult] = useState<{ accountsAffected: number; transactionsAffected: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      const token = extractToken(session);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        const [u, c, b] = await Promise.all([
          fetchJson("/api/users", { headers }),
          fetchJson("/api/clearing-accounts", { headers }),
          fetchJson("/api/bank-accounts", { headers }),
        ]);
        if (cancelled) return;
        setUsers(sortUsersAlpha(Array.isArray(u) ? (u as UserOption[]) : []));
        setClearingAccounts(sortByNameAlpha(Array.isArray(c) ? (c as ClearingOption[]) : []));
        setBankAccounts(sortByNameAlpha(Array.isArray(b) ? (b as BankOption[]) : []));
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Fehler beim Laden der Optionen");
        setUsers([]);
        setClearingAccounts([]);
        setBankAccounts([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const selectionHint = useMemo(() => {
    if (!selectedUserId && !selectedClearingId && !selectedBankId) {
      return "Keine Auswahl getroffen → es wird für alle Konten ausgeführt.";
    }
    return "";
  }, [selectedUserId, selectedClearingId, selectedBankId]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    setAccountErrors(null);
    setResult(null);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/processes/recalculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: selectedUserId ? Number(selectedUserId) : null,
          clearingAccountId: selectedClearingId ? Number(selectedClearingId) : null,
          bankAccountId: selectedBankId ? Number(selectedBankId) : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error ? String(json.error) : `Fehler ${res.status}`;
        setError(msg);
        if (json?.detail) setErrorDetail(String(json.detail));
        if (Array.isArray(json?.errors)) {
          setAccountErrors(
            (json.errors as any[])
              .filter(Boolean)
              .map((e) => ({
                accountId: Number((e as any).accountId),
                soll: String((e as any).soll ?? ""),
                ist: String((e as any).ist ?? ""),
              }))
              .filter((e) => Number.isFinite(e.accountId))
              .sort((a, b) => a.accountId - b.accountId)
          );
        }
        return;
      }
      setResult({
        accountsAffected: Number(json?.accountsAffected ?? 0),
        transactionsAffected: Number(json?.transactionsAffected ?? 0),
      });
    } catch (e: any) {
      setError(e?.message || "Serverfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1>Nachrechenaufgabe</h1>
      <p className="hint">
        Es werden die <b>accountValueAfter</b>-Werte (value-after) der Transaktionen pro Konto in der Reihenfolge der
        Wertstellung (<code>date_valued</code>) neu berechnet. Es wird bei <b>0</b> gestartet.
      </p>

      <div className="form">
        <label>
          Nutzer (optional)
          <select
            className="form-select form-select-max kc-max-420"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">Alle</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.last_name} {u.first_name} ({u.mail})
              </option>
            ))}
          </select>
        </label>

        <label>
          Verrechnungskonto (optional)
          <select
            className="form-select form-select-max kc-max-420"
            value={selectedClearingId}
            onChange={(e) => setSelectedClearingId(e.target.value)}
          >
            <option value="">Alle</option>
            {clearingAccounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Bankkonto (optional)
          <select
            className="form-select form-select-max kc-max-420"
            value={selectedBankId}
            onChange={(e) => setSelectedBankId(e.target.value)}
          >
            <option value="">Alle</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.bank ? ` (${b.bank})` : ""}
              </option>
            ))}
          </select>
        </label>

        {selectionHint && <p className="hint">{selectionHint}</p>}

        <button className="button" type="button" onClick={run} disabled={loading}>
          {loading ? "Läuft…" : "Neu berechnen"}
        </button>

        {error && (
          <div className="kc-section kc-section--light">
            <p className="message" style={{ whiteSpace: "pre-wrap" }}>
              ❌ {error}
            </p>
            {errorDetail && (
              <pre className="kc-pre" style={{ whiteSpace: "pre-wrap" }}>
                {errorDetail}
              </pre>
            )}

            {accountErrors && accountErrors.length > 0 && (
              <div>
                <h3>Konten mit Abweichung</h3>
                <table className="kc-table compact">
                  <thead>
                    <tr>
                      <th>Konto</th>
                      <th>Kontostand Soll</th>
                      <th>Kontostand Ist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountErrors.map((e) => (
                      <tr key={e.accountId}>
                        <td>{e.accountId}</td>
                        <td>{e.soll}</td>
                        <td>{e.ist}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="kc-section kc-section--light">
            <h3>Ergebnis</h3>
            <ul className="kc-list">
              <li>
                Betroffene Konten: <b>{result.accountsAffected}</b>
              </li>
              <li>
                Betroffene Transaktionen: <b>{result.transactionsAffected}</b>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

