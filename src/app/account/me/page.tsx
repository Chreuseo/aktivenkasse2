'use client';

import React, { useEffect, useState } from 'react';
import '@/app/css/tables.css';
import '@/app/css/infobox.css';
import { useSession } from 'next-auth/react';
import { extractToken } from '@/lib/utils';
import { Transaction } from '@/app/types/transaction';
import TransactionTable from '@/app/components/TransactionTable';
import AllowancesTable from '@/app/components/AllowancesTable';

export default function MyAccountPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<{ user: { id: number; first_name: string; last_name: string; mail: string; balance: number; accountId?: number }, planned: Transaction[], past: Transaction[], allowances: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return; // warte bis Session geladen ist
    if (status === 'unauthenticated') {
      setError('Nicht angemeldet.');
      setData(null);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const res = await fetch(`/api/users/me`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setError(json?.error || `${res.status} ${res.statusText}`);
            setData(null);
          }
          return;
        }
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [session, status]);

  if (status === 'loading') return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 900 }}>Lade Sitzung ...</div>;
  if (loading) return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 900 }}>Lade Daten ...</div>;
  if (error) return <div style={{ color: 'var(--accent)', margin: '2rem auto', maxWidth: 900 }}>{error}</div>;
  if (!data) return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 900 }}>Keine Daten gefunden</div>;

  const { user, planned, past, allowances } = data;

  return (
    <div style={{ maxWidth: 900, margin: '2rem auto', padding: '1rem' }}>
      <h2 style={{ marginBottom: '1.2rem' }}>Mein Konto</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{user.first_name} {user.last_name}</div>
        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{user.mail}</div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{Number(user.balance).toFixed(2)} €</span></div>
      </div>

      {/* Rückstellungen */}
      <h3 style={{ marginBottom: '0.8rem' }}>Rückstellungen</h3>
      {allowances.length > 0 ? (
        <table className="kc-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Beschreibung</th>
              <th>Betrag</th>
              <th>Einbehalt</th>
              <th>Erstattung (Datum)</th>
            </tr>
          </thead>
          <tbody>
            {allowances.map((r: any) => (
              <tr key={r.id}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.description || '-'}</td>
                <td>{Number(r.amount).toFixed(2)} €</td>
                <td>{r.withheld ? Number(r.withheld).toFixed(2) + ' €' : '-'}</td>
                <td>{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ color: 'var(--muted)' }}>Keine Daten</div>
      )}

      {/* Geplante Transaktionen (unverarbeitet) */}
      <h3 style={{ margin: '1rem 0 0.6rem' }}>Geplante Transaktionen</h3>
      <TransactionTable transactions={planned} />

      {/* Vergangene Transaktionen (verarbeitet) */}
      <h3 style={{ margin: '1rem 0 0.6rem' }}>Vergangene Transaktionen</h3>
      <TransactionTable transactions={past} />
    </div>
  );
}
