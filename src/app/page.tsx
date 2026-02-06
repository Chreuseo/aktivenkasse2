'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken } from '@/lib/utils';

export default function Page() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const overviewRes = await fetch('/api/overview', { headers, cache: 'no-store' });
        const overviewJson = await overviewRes.json();
        if (!overviewRes.ok) {
          setError(overviewJson?.error || `${overviewRes.status} ${overviewRes.statusText}`);
          setData({});
        } else {
          setData(overviewJson || {});
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setData({});
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  function formatCurrency(value: string | number) {
    const n = typeof value === 'number' ? value : Number(value || 0);
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
  }

  const bankAccounts: Array<{ id: number; name: string; iban: string; balance: string }> = data.bankAccounts ?? [];
  const bankTotal: string = data.bankTotal ?? '0';
  const clearingAccounts: Array<{ id: number; name: string; reimbursementEligible: boolean; balance: string }> = data.clearingAccounts ?? [];
  const users = data.users ?? { liabilities: { sum: '0', count: 0, max: '0' }, receivables: { sum: '0', count: 0, max: '0' } };
  const totals = data.totals ?? { assets: '0', liabilities: '0', net: '0', allowances: '0', netBeforeAllowances: '0' };

  return (
    <div className="wide-container" style={{ padding: '1rem' }}>
      {loading && <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: 'var(--accent)', marginBottom: 12 }}>{error}</div>}
      <div className="overview-grid">
        {/* Kachel 1: Bankkonten */}
        <section className="kc-infobox">
          <h2 className="tile-header">Bankkonten</h2>
          <div className="table-center">
            <table className="kc-table" role="table" aria-label="Bankkonten">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>IBAN</th>
                  <th style={{ textAlign: 'right' }}>Kontostand</th>
                </tr>
              </thead>
              <tbody>
                {bankAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>Keine Daten</td>
                  </tr>
                ) : (
                  bankAccounts.map((b) => (
                    <tr className="kc-row" key={b.id}>
                      <td>{b.name}</td>
                      <td>{b.iban}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(b.balance)}</td>
                    </tr>
                  ))
                )}
                <tr className="kc-sum-row">
                  <td colSpan={2}>Summe</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(bankTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Kachel 2: Verrechnungskonten */}
        <section className="kc-infobox">
          <h2 className="tile-header">Verrechnungskonten</h2>
          <div className="table-center">
            <table className="kc-table" role="table" aria-label="Verrechnungskonten">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Erstattungsfähig</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {clearingAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>Keine Daten</td>
                  </tr>
                ) : (
                  clearingAccounts.map((c: any) => (
                    <tr className="kc-row" key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.reimbursementEligible ? 'Ja' : 'Nein'}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(c.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Kachel 3: Nutzerübersicht */}
        <section className="kc-infobox">
          <h2 className="tile-header">Nutzerübersicht</h2>
          <div className="table-center">
            <table className="kc-table" role="table" aria-label="Nutzerübersicht">
              <thead>
                <tr>
                  <th></th>
                  <th>Gesamtbetrag (€)</th>
                  <th>Anzahl Posten</th>
                  <th>Höchster Einzelbetrag (€)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="kc-row">
                  <td>Kreditoren (offene Verbindlichkeiten)</td>
                  <td>{formatCurrency(users.liabilities?.sum ?? '0')}</td>
                  <td>{users.liabilities?.count ?? 0}</td>
                  <td>{formatCurrency(users.liabilities?.max ?? '0')}</td>
                </tr>
                <tr className="kc-row kc-entry-end">
                  <td>Debitoren (offene Forderungen)</td>
                  <td>{formatCurrency(users.receivables?.sum ?? '0')}</td>
                  <td>{users.receivables?.count ?? 0}</td>
                  <td>{formatCurrency(users.receivables?.max ?? '0')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Kachel 4: Vermögensstände */}
        <section className="kc-infobox">
          <h2 className="tile-header">Vermögensstände</h2>
          <div className="table-center">
            <table className="kc-table" role="table" aria-label="Vermögensstände">
              <thead>
                <tr>
                  <th>Position</th>
                  <th style={{ textAlign: 'right' }}>Betrag</th>
                </tr>
              </thead>
              <tbody>
                <tr className="kc-row">
                  <td>Aktiva (liquide Mittel + Forderungen)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.assets)}</td>
                </tr>
                <tr className="kc-row kc-entry-end">
                  <td>Passiva (Verbindlichkeiten)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.liabilities)}</td>
                </tr>
                {/* Neue Zeile: Rückstellungen (Summe der offenen Allowances) */}
                <tr className="kc-row">
                  <td>Rückstellungen (offen)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.allowances ?? '0')}</td>
                </tr>
                <tr className="kc-sum-row">
                  <td>Nettovermögen / Finanzsaldo</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}