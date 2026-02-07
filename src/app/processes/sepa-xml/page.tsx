"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: number;
  sepa_mandate: boolean;
  sepa_mandate_date: string | null;
  sepa_mandate_reference: string | null;
  sepa_iban: string | null;
  sepa_bic: string | null;
};

type BankAccountRow = {
  id: number;
  name: string;
  owner: string;
  bank: string;
  iban: string;
  accountId: number;
  balance: number;
};

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

export default function SepaXmlProcessPage() {
  const [op, setOp] = useState<CompareOp>("kleiner");
  const [amount, setAmount] = useState<string>("0");

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [rows, setRows] = useState<Array<any>>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filteredOnce, setFilteredOnce] = useState(false);

  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[] | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string>("");

  const [collectionDate, setCollectionDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [remark, setRemark] = useState<string>("");
  const [sendInfoMail, setSendInfoMail] = useState<boolean>(false);
  const [createTransactions, setCreateTransactions] = useState<boolean>(false);

  const [remittanceGlobal, setRemittanceGlobal] = useState<string>("");
  const [remittanceByKey, setRemittanceByKey] = useState<Record<string, string>>({});

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
        const msg = data && typeof data === "object" && "error" in data ? String((data as any).error) : `Fehler ${res.status}`;
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

  const loadBankAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bank-accounts", { cache: "no-store" });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data && typeof data === "object" && "error" in data ? String((data as any).error) : `Fehler ${res.status}`;
        setError(msg);
        return [] as BankAccountRow[];
      }
      setBankAccounts(data as BankAccountRow[]);
      return data as BankAccountRow[];
    } catch (e: any) {
      setError(e?.message || "Fehler beim Laden der Bankkonten");
      return [] as BankAccountRow[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBankAccounts().then((list) => {
      if (list?.length && !bankAccountId) setBankAccountId(String(list[0].id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = useCallback(async () => {
    setStatusMsg(null);
    setSelected({});

    const data = users ?? (await loadUsers());

    // Nur Einträge mit aktivem SEPA-Mandat
    const withMandate = (data || []).filter((u: any) => Boolean(u?.sepa_mandate));

    const applied = applyFilter(withMandate);
    const r = applied.map((u) => ({
      key: `user-${u.id}`,
      type: "user" as const,
      name: `${u.first_name} ${u.last_name}`,
      mail: u.mail,
      balance: u.balance ?? 0,
      sepaOk: Boolean(u.sepa_mandate && u.sepa_iban && u.sepa_mandate_reference && u.sepa_mandate_date),
      source: u,
    }));
    setRows(r);

    setFilteredOnce(true);
  }, [users, loadUsers, applyFilter]);

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

  const canGenerate = filteredOnce && rows.length > 0 && anyChecked && !loading;

  const handleGenerateXml = useCallback(async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);

    try {
      const chosen = rows.filter((r) => selected[r.key]);
      const ids = chosen.map((r) => Number(r.source?.id)).filter((n) => Number.isFinite(n));

      const byId: Record<string, string> = {};
      chosen.forEach((r) => {
        const v = (remittanceByKey[r.key] || "").trim();
        if (v) byId[String(r.source.id)] = v;
      });

      const res = await fetch("/api/sepa-xml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientIds: ids,
          collectionDate: new Date(collectionDate + "T00:00:00.000Z").toISOString(),
          bankAccountId: Number(bankAccountId),
          remark: remark?.trim() || undefined,
          sendInfoMail,
          createTransactions,
          remittanceGlobal: remittanceGlobal?.trim(),
          remittanceByUserId: byId,
        }),
      });

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data?.errors) && data.errors.length ? ` (${data.errors.length} Fehler in Auswahl)` : "";
        throw new Error((data && data.error) ? String(data.error) + details : `Fehler ${res.status}`);
      }

      const xml: string = String(data.xml || "");
      if (!xml) throw new Error("Keine XML zurückgegeben");

      const filename = `sepa-${(data.messageId || "export").toString()}.xml`;
      const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      const lines: string[] = [];
      lines.push(`XML erzeugt: ${data.recipients} Position(en), Summe ${formatCurrency(Number(data.totalAmount) || 0)}.`);
      if (data.createTransactions) {
        const cnt = Array.isArray(data.createdTransactionIds) ? data.createdTransactionIds.length : 0;
        lines.push(`Transaktionen: ${cnt} Einzelbuchungen (paired) erzeugt.`);
      }
      if (data.sendInfoMail) {
        if (data.mailResult) {
          lines.push(`Info-Mail: ${data.mailResult.success}/${data.mailResult.total} erfolgreich.`);
          if (data.mailResult.failed) lines.push(`Info-Mail fehlgeschlagen: ${data.mailResult.failed}.`);
        } else {
          lines.push(`Info-Mail: angestoßen.`);
        }
      }
      if (Array.isArray(data.errors) && data.errors.length) {
        lines.push(`Hinweise/Fehler (ignoriert): ${data.errors.length}`);
      }
      setStatusMsg(lines.join("\n"));
    } catch (e: any) {
      setError(e?.message || "Fehler beim Erzeugen");
    } finally {
      setLoading(false);
    }
  }, [canGenerate, rows, selected, bankAccountId, collectionDate, remark, sendInfoMail, createTransactions, remittanceGlobal, remittanceByKey]);

  const showNegHint = op === "kleiner" && parseAmount() > 0;
  const bankAccountOptions = bankAccounts || [];

  return (
    <div className="wide-container" style={{ width: "100%", maxWidth: 1100 }}>
      <section style={{ width: "100%", margin: "0 auto 1rem auto" }}>
        <h2 style={{ margin: "0 0 0.75rem 0" }}>SEPA-XML (Einzug)</h2>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
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

        {showNegHint && (
          <div className="message" style={{ marginTop: "0.5rem" }}>
            Hinweis: Für Einzug ist i.d.R. „kleiner als 0“ sinnvoll (nur negative Kontostände).
          </div>
        )}
      </section>

      <section style={{ width: "100%", margin: "0 auto 1rem auto" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="form" style={{ gap: "0.4rem", minWidth: 280, flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Verwendungszweck (global, Pflicht)</span>
            <input
              className="form-select form-select-max"
              type="text"
              value={remittanceGlobal}
              onChange={(e) => setRemittanceGlobal(e.target.value)}
              placeholder="z.B. Mitgliedsbeitrag"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", minWidth: 220 }}>
            <span style={{ fontWeight: 600 }}>Einzugsdatum</span>
            <input className="form-select" type="date" value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", minWidth: 280 }}>
            <span style={{ fontWeight: 600 }}>Einzug über Bankkonto</span>
            <select className="kc-select kc-select--md" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">Bitte wählen…</option>
              {bankAccountOptions.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name} ({b.iban})
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form" style={{ gap: "0.4rem", marginTop: "0.6rem" }}>
          <span style={{ fontWeight: 600 }}>Bemerkung (optional)</span>
          <textarea
            className="form-select"
            rows={3}
            placeholder="Freitext…"
            value={remark}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemark(e.target.value)}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: "0.6rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={sendInfoMail} onChange={(e) => setSendInfoMail(e.target.checked)} />
            <span>Info-Mail senden</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={createTransactions} onChange={(e) => setCreateTransactions(e.target.checked)} />
            <span>Transaktionen erzeugen</span>
          </label>

          <button className="button" disabled={!canGenerate || !remittanceGlobal.trim() || !bankAccountId} onClick={handleGenerateXml}>
            {loading ? "Erzeuge…" : "XML erzeugen"}
          </button>
        </div>

        {statusMsg ? <div className="message" style={{ whiteSpace: "pre-line" }}>{statusMsg}</div> : null}
        {error ? <div className="message" style={{ color: "#ef4444" }}>{error}</div> : null}
      </section>

      <section className="table-center" style={{ width: "100%" }}>
        <table className="kc-table">
          <thead>
            <tr>
              <th className="kc-checkbox">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Alle auswählen" />
              </th>
              <th>Name</th>
              <th>Mail</th>
              <th>Kontostand</th>
              <th>SEPA</th>
              <th>Verwendungszweck je Zeile (optional)</th>
            </tr>
          </thead>
          <tbody>
            {filteredOnce && rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "1rem", color: "#9aa4b2" }}>
                  Keine Einträge für den aktuellen Filter.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.key} className="kc-row">
                <td className="kc-checkbox">
                  <input
                    type="checkbox"
                    checked={selected[r.key] ?? false}
                    onChange={(e) => setSelected((s) => ({ ...s, [r.key]: e.target.checked }))}
                    aria-label={`Auswählen ${r.name}`}
                  />
                </td>
                <td>{r.name}</td>
                <td>{r.mail}</td>
                <td>{formatCurrency(Number(r.balance) || 0)}</td>
                <td style={{ color: r.sepaOk ? "var(--primary)" : "#ef4444" }}>{r.sepaOk ? "OK" : "fehlt"}</td>
                <td>
                  <input
                    className="form-select form-select-max"
                    type="text"
                    value={remittanceByKey[r.key] ?? ""}
                    onChange={(e) => setRemittanceByKey((m) => ({ ...m, [r.key]: e.target.value }))}
                    placeholder="z.B. Jan 2026"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
