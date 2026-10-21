"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken, fetchJson } from "@/lib/utils";

type AccountOption = { accountId: number; label: string };
type Row = { from: string; to: string | null; amount: number; exists: boolean; set: boolean };

const TYPE_OPTIONS = [
  { value: "user", label: "Benutzer" },
  { value: "clearing_account", label: "Verrechnungskonto" },
  { value: "bank", label: "Bankkonto" },
];

function fmtDate(s: string | null) {
  if (!s) return "offen";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
}

export default function DuesBackfillPage() {
  const { data: session } = useSession();
  const token = extractToken(session as any);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const [type, setType] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAccountId("");
    setAccounts([]);
    if (!type) return;
    fetchJson(`/api/interests/backfill?type=${type}`, { headers, cache: "no-store" })
      .then((d) => setAccounts(d as AccountOption[]))
      .catch((e) => setError(e?.message || String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, token]);

  async function loadRows(id: string) {
    setRows([]);
    setStatus(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const d = await fetchJson(`/api/interests/backfill?accountId=${id}`, { headers, cache: "no-store" });
      setRows((d.rows as any[]).map((r) => ({ ...r, set: !r.exists })));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    const items = rows.filter((r) => r.set).map((r) => ({ from: r.from, to: r.to, amount: r.amount }));
    if (!items.length) return;
    setError(null);
    setStatus(null);
    try {
      const d = await fetchJson("/api/interests/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ accountId: Number(accountId), items }),
      });
      setStatus(`${d.created} Fälligkeit(en) angelegt.`);
      await loadRows(accountId);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  const selectedCount = rows.filter((r) => r.set).length;

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Fälligkeiten nachtragen</h2>

      <div className="kc-panel kc-panel--spaced">
        <div className="kc-filterbar">
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Kontotyp</span>
            <select className="kc-input" value={type} onChange={(e) => { setType(e.target.value); setRows([]); }}>
              <option value="">Bitte wählen</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Konto</span>
            <select
              className="kc-input"
              value={accountId}
              disabled={!type}
              onChange={(e) => { setAccountId(e.target.value); loadRows(e.target.value); }}
            >
              <option value="">Bitte wählen</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={String(a.accountId)}>{a.label}</option>
              ))}
            </select>
          </label>
          <button className="button" onClick={save} disabled={!selectedCount}>
            Ausgewählte setzen ({selectedCount})
          </button>
        </div>
      </div>

      {loading && <div className="kc-status">Lade Daten ...</div>}
      {error && <div className="kc-error">Fehler: {error}</div>}
      {status && <div className="kc-status">{status}</div>}

      {accountId && !loading && (
        <table className="kc-table">
          <thead>
            <tr>
              <th>Von</th>
              <th>Bis</th>
              <th>Betrag</th>
              <th>Setzen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="kc-table-note kc-table-note--muted">Keine Zeiträume mit negativem Kontostand.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.from}-${i}`} className="kc-row">
                <td>
                  <input className="kc-input" type="date" value={r.from} onChange={(e) => update(i, { from: e.target.value })} />
                </td>
                <td>{fmtDate(r.to)}</td>
                <td>{fmtMoney(r.amount)}</td>
                <td className="kc-checkbox">
                  <input type="checkbox" checked={r.set} onChange={(e) => update(i, { set: e.target.checked })} />
                  {r.exists && <span className="kc-muted"> bereits vorhanden</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
