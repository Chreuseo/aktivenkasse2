"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: number;
};

type ClearingAccountRow = {
  id: number;
  name: string; // Verrechnungskonto-Name
  responsible: string | null;
  responsibleMail: string | null;
  balance: number;
};

type Mode = "Nutzer" | "Verrechnungskonto";

type CompareOp = "kleiner" | "größer" | "ungleich" | "Betrag größer";

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export default function MailProcessPage() {
  const [mode, setMode] = useState<Mode>("Nutzer");
  const [op, setOp] = useState<CompareOp>("kleiner");
  const [amount, setAmount] = useState<string>("0");

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [accounts, setAccounts] = useState<ClearingAccountRow[] | null>(null);

  const [filteredOnce, setFilteredOnce] = useState(false);
  const [rows, setRows] = useState<Array<any>>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [subject, setSubject] = useState<string>("Zahlungsaufforderung / Kontoinformation");
  const [remark, setRemark] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hilfsfunktionen
  const parseAmount = useCallback(() => {
    const a = Number((amount || "").toString().replace(",", "."));
    return isNaN(a) ? 0 : a;
  }, [amount]);

  const applyFilter = useCallback(
    (list: any[]): any[] => {
      const a = parseAmount();
      const fn = (bal: number) => {
        switch (op) {
          case "kleiner":
            return bal < a;
          case "größer":
            return bal > a;
          case "ungleich":
            return bal !== a;
          case "Betrag größer":
            return Math.abs(bal) > a;
          default:
            return true;
        }
      };
      return list.filter((it) => fn(Number(it.balance) || 0));
    },
    [op, parseAmount]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Fehler ${res.status}`);
      }
      const data: UserRow[] = await res.json();
      setUsers(data);
      return data;
    } catch (e: any) {
      setError(e?.message || "Fehler beim Laden der Nutzer");
      return [] as UserRow[];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clearing-accounts", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Fehler ${res.status}`);
      }
      const data: ClearingAccountRow[] = await res.json();
      setAccounts(data);
      return data;
    } catch (e: any) {
      setError(e?.message || "Fehler beim Laden der Verrechnungskonten");
      return [] as ClearingAccountRow[];
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset Auswahl bei Moduswechsel
  useEffect(() => {
    setSelected({});
    setRows([]);
    setFilteredOnce(false);
    setStatusMsg(null);
  }, [mode]);

  const handleFilter = useCallback(async () => {
    setStatusMsg(null);
    setSelected({});

    if (mode === "Nutzer") {
      const data = users ?? (await loadUsers());
      const applied = applyFilter(data);
      // Auf Tabellenform abbilden: Verrechnungskonto leer
      const r = applied.map((u) => ({
        key: `user-${u.id}`,
        type: "user" as const,
        vcName: "-",
        name: `${u.first_name} ${u.last_name}`,
        mail: u.mail,
        balance: u.balance ?? 0,
        source: u,
      }));
      setRows(r);
    } else {
      const data = accounts ?? (await loadAccounts());
      // Nur mit Verantwortlichem
      const withResp = (data || []).filter((a) => !!a.responsible && !!a.responsibleMail);
      const applied = applyFilter(withResp);
      const r = applied.map((a) => ({
        key: `ca-${a.id}`,
        type: "clearing" as const,
        vcName: a.name,
        name: a.responsible!,
        mail: a.responsibleMail!,
        balance: a.balance ?? 0,
        source: a,
      }));
      setRows(r);
    }

    setFilteredOnce(true);
  }, [mode, users, accounts, loadUsers, loadAccounts, applyFilter]);

  const allChecked = useMemo(() => {
    if (!rows?.length) return false;
    return rows.every((r) => selected[r.key]);
  }, [rows, selected]);

  const anyChecked = useMemo(() => rows?.some((r) => selected[r.key]) ?? false, [rows, selected]);

  const toggleAll = useCallback(() => {
    if (!rows?.length) return;
    if (allChecked) {
      setSelected({});
    } else {
      const s: Record<string, boolean> = {};
      rows.forEach((r) => (s[r.key] = true));
      setSelected(s);
    }
  }, [rows, allChecked]);

  const canSend = filteredOnce && rows.length > 0 && anyChecked && !loading;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);
    try {
      const chosen = rows.filter((r) => selected[r.key]);
      const ids = chosen.map((r) => Number(r.source?.id)).filter((n) => Number.isFinite(n));
      const type = mode === "Nutzer" ? "user" : "clearing";
      const res = await fetch("/api/mails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: { type, ids }, remark: remark?.trim() || undefined, subject: subject?.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Fehler ${res.status}`);
      }
      const lines: string[] = [];
      lines.push(`Versand angestoßen: ${data.success}/${data.total} erfolgreich.`);
      if (data.failed) lines.push(`Fehlgeschlagen: ${data.failed}.`);
      if (Array.isArray(data.errors) && data.errors.length) {
        lines.push("— Details:");
        data.errors.slice(0, 5).forEach((e: any) => lines.push(`  • ${e.to}: ${e.error}`));
        if (data.errors.length > 5) lines.push(`  … und ${data.errors.length - 5} weitere`);
      }
      setStatusMsg(lines.join("\n"));
    } catch (e: any) {
      setError(e?.message || "Fehler beim Sendevorgang");
    } finally {
      setLoading(false);
    }
  }, [canSend, rows, selected, mode, remark, subject]);

  const showNegHint = op === "kleiner" && parseAmount() > 0;

  return (
    <div className="wide-container" style={{ width: "100%", maxWidth: 900 }}>
      {/* Filterzeile */}
      <section style={{ width: "100%", margin: "0 auto 1rem auto" }}>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: 600 }}>Typ</span>
            <select
              className="kc-select kc-select--md"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="Nutzer">Nutzer</option>
              <option value="Verrechnungskonto">Verrechnungskonto</option>
            </select>
          </label>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>Kontostand</span>
              <select className="kc-select kc-select--md" value={op} onChange={(e) => setOp(e.target.value as CompareOp)}>
                <option>kleiner</option>
                <option>größer</option>
                <option>ungleich</option>
                <option>Betrag größer</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>Betrag (€)</span>
              <input
                className="form-select form-select-max"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ minWidth: 140 }}
              />
            </label>

            <button className="button" onClick={handleFilter} disabled={loading}>
              {loading ? "Laden…" : "Filtern"}
            </button>
          </div>
        </div>
        {showNegHint && (
          <div className="message" style={{ marginTop: "0.5rem" }}>
            Hinweis: Bei Auswahl „kleiner“ und positivem Betrag werden positive wie negative Kontostände berücksichtigt (Schuldenstände sind als Negativwert einzutragen).
          </div>
        )}
      </section>

      {/* Betreff + Bemerkung + Senden */}
      <section style={{ width: "100%", maxWidth: 1200, margin: "0 auto 1rem auto" }}>
        <label className="form" style={{ gap: "0.4rem" }}>
          <span style={{ fontWeight: 600 }}>Betreff</span>
          <input
            className="form-select form-select-max"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Zahlungsaufforderung / Kontoinformation"
          />
        </label>
        <label className="form" style={{ gap: "0.4rem", marginTop: "0.6rem" }}>
          <span style={{ fontWeight: 600 }}>Bemerkung (optional)</span>
          <textarea
            className="form-select"
            rows={3}
            placeholder="Freitext für die E-Mail…"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </label>
        <div style={{ marginTop: "0.6rem" }}>
          <button className="button" disabled={!canSend} onClick={handleSend}>
            Senden
          </button>
        </div>
        {statusMsg ? <div className="message" style={{ whiteSpace: "pre-line" }}>{statusMsg}</div> : null}
        {error ? (
          <div className="message" style={{ color: "#ef4444" }}>
            {error}
          </div>
        ) : null}
      </section>

      {/* Tabelle */}
      <section className="table-center" style={{ width: "100%" }}>
        <table className="kc-table">
          <thead>
            <tr>
              <th className="kc-checkbox">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Alle auswählen" />
              </th>
              <th>Verrechnungskonto</th>
              <th>Name</th>
              <th>Mail</th>
              <th>Kontostand</th>
            </tr>
          </thead>
          <tbody>
            {filteredOnce && rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "1rem", color: "#9aa4b2" }}>
                  Keine Einträge für den aktuellen Filter.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.key} className="kc-row">
                <td className="kc-checkbox">
                  <input
                    type="checkbox"
                    checked={!!selected[r.key]}
                    onChange={(e) => setSelected((s) => ({ ...s, [r.key]: e.target.checked }))}
                    aria-label={`Auswählen ${r.name}`}
                  />
                </td>
                <td>{r.vcName}</td>
                <td>{r.name}</td>
                <td>{r.mail}</td>
                <td>{formatCurrency(Number(r.balance) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
