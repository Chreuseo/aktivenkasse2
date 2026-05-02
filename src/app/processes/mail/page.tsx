"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { extractToken } from "@/lib/utils";

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

type TableRow = {
  key: string;
  type: "user" | "clearing";
  vcName: string;
  name: string;
  mail: string;
  balance: number;
  source: UserRow | ClearingAccountRow;
};

type TxReceiptRow = {
  id: number;
  date: string;
  description: string;
  amount: number;
  attachmentId?: number;
};

type ReceiptSelection = {
  recipientId: number;
  transactionIds: number[];
};

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
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>("Nutzer");
  const [op, setOp] = useState<CompareOp>("kleiner");
  const [amount, setAmount] = useState<string>("0");

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [accounts, setAccounts] = useState<ClearingAccountRow[] | null>(null);

  const [filteredOnce, setFilteredOnce] = useState(false);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [subject, setSubject] = useState<string>("Zahlungsaufforderung / Kontoinformation");
  const [remark, setRemark] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [setDues, setSetDues] = useState<boolean>(false);
  const [attachReceipts, setAttachReceipts] = useState<boolean>(false);
  const [receiptsExpanded, setReceiptsExpanded] = useState<Record<string, boolean>>({});
  const [receiptsByRow, setReceiptsByRow] = useState<Record<string, TxReceiptRow[]>>({});
  const [receiptLoadingByRow, setReceiptLoadingByRow] = useState<Record<string, boolean>>({});
  const [receiptErrorByRow, setReceiptErrorByRow] = useState<Record<string, string | null>>({});
  const [selectedReceiptsByRow, setSelectedReceiptsByRow] = useState<Record<string, Record<number, boolean>>>({});

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
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && typeof data === "object" && "error" in data) ? String((data as any).error) : `Fehler ${res.status}`;
        setError(msg);
        return [] as UserRow[];
      }
      setUsers(data as UserRow[]);
      return data as UserRow[];
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
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && typeof data === "object" && "error" in data) ? String((data as any).error) : `Fehler ${res.status}`;
        setError(msg);
        return [] as ClearingAccountRow[];
      }
      setAccounts(data as ClearingAccountRow[]);
      return data as ClearingAccountRow[];
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
    setReceiptsExpanded({});
    setReceiptsByRow({});
    setReceiptLoadingByRow({});
    setReceiptErrorByRow({});
    setSelectedReceiptsByRow({});
    if (mode !== "Verrechnungskonto") {
      setAttachReceipts(false);
    }
  }, [mode]);

  const loadReceiptsForRow = useCallback(async (row: TableRow): Promise<void> => {
    const recipientId = Number(row.source.id);
    if (!Number.isFinite(recipientId)) return;

    setReceiptLoadingByRow((s) => ({ ...s, [row.key]: true }));
    setReceiptErrorByRow((s) => ({ ...s, [row.key]: null }));
    try {
      const token = extractToken(session);
      const endpoint = row.type === "clearing"
        ? `/api/clearing-accounts/${recipientId}`
        : `/api/users/${recipientId}`;
      const res = await fetch(endpoint, {
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && typeof data === "object" && "error" in data) ? String((data as any).error) : `Fehler ${res.status}`;
        setReceiptErrorByRow((s) => ({ ...s, [row.key]: msg }));
        setReceiptsByRow((s) => ({ ...s, [row.key]: [] }));
        return;
      }
      const txs = [...(Array.isArray(data?.planned) ? data.planned : []), ...(Array.isArray(data?.past) ? data.past : [])]
        .map((tx: any) => ({
          id: Number(tx?.id),
          date: String(tx?.date || ""),
          description: String(tx?.description || "-"),
          amount: Number(tx?.amount) || 0,
          attachmentId: tx?.attachmentId ? Number(tx.attachmentId) : undefined,
        }))
        .filter((tx: TxReceiptRow) => Number.isFinite(tx.id));
      setReceiptsByRow((s) => ({ ...s, [row.key]: txs }));
    } catch (e: any) {
      setReceiptErrorByRow((s) => ({ ...s, [row.key]: e?.message || "Fehler beim Laden der Belege" }));
      setReceiptsByRow((s) => ({ ...s, [row.key]: [] }));
    } finally {
      setReceiptLoadingByRow((s) => ({ ...s, [row.key]: false }));
    }
  }, [session]);

  const handleFilter = useCallback(async () => {
    setStatusMsg(null);
    setSelected({});
    setReceiptsExpanded({});
    setReceiptsByRow({});
    setReceiptLoadingByRow({});
    setReceiptErrorByRow({});
    setSelectedReceiptsByRow({});

    if (mode === "Nutzer") {
      const data = users ?? (await loadUsers());
      const applied = applyFilter(data);
      // Auf Tabellenform abbilden: Verrechnungskonto leer
      const r: TableRow[] = applied.map((u) => ({
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
      const r: TableRow[] = applied.map((a) => ({
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

  const hasReceiptAttachment = useCallback((tx: TxReceiptRow): boolean => Boolean(tx.attachmentId), []);

  const toggleReceipts = useCallback(async (row: TableRow): Promise<void> => {
    const isOpen = receiptsExpanded[row.key];
    if (isOpen) {
      setReceiptsExpanded((s) => ({ ...s, [row.key]: false }));
      return;
    }
    setReceiptsExpanded((s) => ({ ...s, [row.key]: true }));
    if (!receiptsByRow[row.key]) {
      await loadReceiptsForRow(row);
    }
  }, [receiptsExpanded, receiptsByRow, loadReceiptsForRow]);

  const handleSend = useCallback(async (): Promise<void> => {
    if (!canSend) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);
    try {
      const chosen = rows.filter((r) => selected[r.key]);
      const ids = chosen.map((r) => Number(r.source?.id)).filter((n) => Number.isFinite(n));
      const type: "user" | "clearing" = mode === "Nutzer" ? "user" : "clearing";
      const url = setDues ? "/api/mails/with-dues" : "/api/mails";
      const receiptSelections: ReceiptSelection[] | undefined =
        attachReceipts
          ? chosen
              .map((row) => {
                const transactionIds = Object.entries(selectedReceiptsByRow[row.key] || {})
                  .filter(([, isChecked]) => isChecked)
                  .map(([txId]) => Number(txId))
                  .filter((n) => Number.isFinite(n));
                return {
                  recipientId: Number(row.source.id),
                  transactionIds,
                };
              })
              .filter((entry) => Number.isFinite(entry.recipientId) && entry.transactionIds.length > 0)
          : undefined;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: { type, ids },
          remark: remark?.trim() || undefined,
          subject: subject?.trim() || undefined,
          receiptSelections,
        }),
      });
      const data: { success?: number; total?: number; failed?: number; errors?: { to: string; error: string }[]; duesCreated?: number; error?: string } = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const msg = data?.error || data?.errors?.[0]?.error || `Fehler ${res.status}`;
        setError(msg);
        return;
      }
      const lines: string[] = [];
      lines.push(`Versand angestoßen: ${data.success}/${data.total} erfolgreich.`);
      if (data.failed) lines.push(`Fehlgeschlagen: ${data.failed}.`);
      if (typeof data.duesCreated === "number") {
        lines.push(`Fälligkeiten erzeugt: ${data.duesCreated}.`);
      }
      if (Array.isArray(data.errors) && data.errors.length) {
        lines.push("— Details:");
        data.errors.slice(0, 5).forEach((e) => lines.push(`  • ${e.to}: ${e.error}`));
        if (data.errors.length > 5) lines.push(`  … und ${data.errors.length - 5} weitere`);
      }
      setStatusMsg(lines.join("\n"));
    } catch (e: any) {
      setError(e?.message || "Fehler beim Sendevorgang");
    } finally {
      setLoading(false);
    }
  }, [canSend, rows, selected, mode, remark, subject, setDues, attachReceipts, selectedReceiptsByRow]);

  const showNegHint = op === "kleiner" && parseAmount() > 0;

  return (
    <div className="kc-page">
      {/* Filterzeile */}
      <section className="kc-process-filter">
        <div className="kc-filter-grid">
          <label className="kc-label-col">
            <span>Typ</span>
            <select
              className="kc-select kc-select--md"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="Nutzer">Nutzer</option>
              <option value="Verrechnungskonto">Verrechnungskonto</option>
            </select>
          </label>

          <div className="kc-filter-subgrid">
            <label className="kc-label-col">
              <span>Kontostand</span>
              <select className="kc-select kc-select--md" value={op} onChange={(e) => setOp(e.target.value as CompareOp)}>
                <option>kleiner</option>
                <option>größer</option>
                <option>ungleich</option>
                <option>Betrag größer</option>
              </select>
            </label>

            <label className="kc-label-col">
              <span>Betrag (€)</span>
              <input
                className="form-select form-select-max kc-minw-140"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>

            <button className="button" onClick={handleFilter} disabled={loading}>
              {loading ? "Laden…" : "Filtern"}
            </button>
          </div>
        </div>
        {showNegHint && (
          <div className="message kc-message--spaced">
            Hinweis: Bei Auswahl „kleiner“ und positivem Betrag werden positive wie negative Kontostände berücksichtigt (Schuldenstände sind als Negativwert einzutragen).
          </div>
        )}
      </section>

      {/* Betreff + Bemerkung + Senden */}
      <section className="kc-process-section">
        <label className="form kc-form--tight">
          <span className="kc-fw-600">Betreff</span>
          <input
            className="form-select form-select-max"
            type="text"
            value={subject}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
            placeholder="Zahlungsaufforderung / Kontoinformation"
          />
        </label>
        <label className="form kc-form--tight u-mt-2">
          <span className="kc-fw-600">Bemerkung (optional)</span>
          <textarea
            className="form-select"
            rows={3}
            placeholder="Freitext für die E-Mail…"
            value={remark}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemark(e.target.value)}
          />
        </label>

        <div className="kc-checkline u-mt-2">
          <input
            type="checkbox"
            checked={setDues}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSetDues(e.target.checked)}
          />
          <span>Fälligkeiten setzen</span>
        </div>

        <div className="kc-checkline u-mt-2">
          <input
            type="checkbox"
            checked={attachReceipts}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const checked = e.target.checked;
              setAttachReceipts(checked);
              if (!checked) {
                setReceiptsExpanded({});
                setSelectedReceiptsByRow({});
              }
            }}
          />
          <span>Belege anfügen</span>
        </div>

        <div className="u-mt-2">
          <button className="button" disabled={!canSend} onClick={handleSend}>
            Senden
          </button>
        </div>
        {statusMsg ? <div className="message kc-preline">{statusMsg}</div> : null}
        {error ? (
          <div className="message kc-message--error">
            {error}
          </div>
        ) : null}
      </section>

      {/* Tabelle */}
      <section className="table-center">
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
              {attachReceipts ? <th>Belege</th> : null}
            </tr>
          </thead>
          <tbody>
            {filteredOnce && rows.length === 0 ? (
              <tr>
                <td colSpan={attachReceipts ? 6 : 5} className="kc-table-note kc-table-note--muted">
                  Keine Einträge für den aktuellen Filter.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const rowReceipts = receiptsByRow[r.key] || [];
              const rowLoading = receiptLoadingByRow[r.key];
              const rowError = receiptErrorByRow[r.key];
              const rowSelectedReceipts = selectedReceiptsByRow[r.key] || {};
              const selectedCount = Object.values(rowSelectedReceipts).filter(Boolean).length;
              const showReceiptColumn = attachReceipts;
              const isExpanded = receiptsExpanded[r.key];
              return (
                <React.Fragment key={r.key}>
                  <tr className="kc-row">
                    <td className="kc-checkbox">
                      <input
                        type="checkbox"
                        checked={selected[r.key] ?? false}
                        onChange={(e) => setSelected((s) => ({ ...s, [r.key]: e.target.checked }))}
                        aria-label={`Auswählen ${r.name}`}
                      />
                    </td>
                    <td>{r.vcName}</td>
                    <td>{r.name}</td>
                    <td>{r.mail}</td>
                    <td>{formatCurrency(Number(r.balance) || 0)}</td>
                    {showReceiptColumn ? (
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            void toggleReceipts(r);
                          }}
                          style={{ border: "none", background: "transparent", color: "#2563eb", textDecoration: "underline", cursor: "pointer", padding: 0 }}
                        >
                          {isExpanded ? "Belege ausblenden" : "Belege"}
                          {selectedCount > 0 ? ` (${selectedCount})` : ""}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {showReceiptColumn && isExpanded ? (
                    <tr>
                      <td colSpan={6} className="kc-table-note">
                        {rowLoading ? (
                          <div>Lade Transaktionen…</div>
                        ) : rowError ? (
                          <div className="kc-message--error">{rowError}</div>
                        ) : rowReceipts.length === 0 ? (
                          <div>Keine Transaktionen gefunden.</div>
                        ) : (
                          <table className="kc-table" style={{ marginTop: 8 }}>
                            <thead>
                              <tr>
                                <th className="kc-checkbox" />
                                <th>Datum</th>
                                <th>Beschreibung</th>
                                <th>Betrag</th>
                                <th>Beleg</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rowReceipts.map((tx) => {
                                const canAttach = hasReceiptAttachment(tx);
                                return (
                                  <tr key={`${r.key}-tx-${tx.id}`}>
                                    <td className="kc-checkbox">
                                      <input
                                        type="checkbox"
                                        disabled={!canAttach}
                                        checked={rowSelectedReceipts[tx.id] ?? false}
                                        onChange={(e) =>
                                          setSelectedReceiptsByRow((s) => ({
                                            ...s,
                                            [r.key]: {
                                              ...(s[r.key] || {}),
                                              [tx.id]: e.target.checked,
                                            },
                                          }))
                                        }
                                        aria-label={`Beleg auswählen für Transaktion ${tx.id}`}
                                      />
                                    </td>
                                    <td>{tx.date ? new Intl.DateTimeFormat("de-DE").format(new Date(tx.date)) : "-"}</td>
                                    <td>{tx.description}</td>
                                    <td>{formatCurrency(tx.amount)}</td>
                                    <td>{canAttach ? "vorhanden" : "kein Beleg"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
