import React from 'react';
import { headers } from 'next/headers';

async function getOverviewData() {
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'development' ? 'http' : 'https');
  if (!host) throw new Error('Fehlender Host-Header');
  const baseUrl = `${proto}://${host}`;
  const cookie = hdrs.get('cookie') ?? '';
  const resp = await fetch(`${baseUrl}/api/overview`, {
    cache: 'no-store',
    headers: { cookie },
  });
  if (!resp.ok) throw new Error('Fehler beim Laden der Übersicht');
  return resp.json();
}

function formatCurrency(value: string | number) {
  const n = typeof value === 'number' ? value : Number(value || 0);
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export default async function Page() {
  const data = await getOverviewData();
  const bankAccounts: Array<{ id: number; name: string; iban: string; balance: string }>= data.bankAccounts ?? [];
  const bankTotal: string = data.bankTotal ?? '0';
  const clearingAccounts: Array<{ id: number; name: string; reimbursementEligible: boolean; balance: string }>= data.clearingAccounts ?? [];
  const clearingTotal: string = data.clearingTotal ?? '0';
  const users = data.users ?? { liabilities: { sum: '0', count: 0, max: '0' }, receivables: { sum: '0', count: 0, max: '0' } };
  const totals = data.totals ?? { assets: '0', liabilities: '0', net: '0' };

  return (
    <div className="wide-container" style={{ padding: '1rem' }}>
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
                  clearingAccounts.map((c) => (
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
                  <th>Summe</th>
                  <th>Anzahl</th>
                  <th>Maximum</th>
                </tr>
              </thead>
              <tbody>
                <tr className="kc-row">
                  <td>Verbindlichkeiten</td>
                  <td>{formatCurrency(users.liabilities?.sum ?? '0')}</td>
                  <td>{users.liabilities?.count ?? 0}</td>
                  <td>{formatCurrency(users.liabilities?.max ?? '0')}</td>
                </tr>
                <tr className="kc-row kc-entry-end">
                  <td>Offene Forderungen</td>
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
                  <td>Guthaben und offene Forderungen</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.assets)}</td>
                </tr>
                <tr className="kc-row kc-entry-end">
                  <td>Verbindlichkeiten</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totals.liabilities)}</td>
                </tr>
                <tr className="kc-sum-row">
                  <td>Restgeld</td>
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