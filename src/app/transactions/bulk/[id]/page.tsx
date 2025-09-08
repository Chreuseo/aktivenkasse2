'use client';

import React, { useEffect, useState } from 'react';
import '@/app/css/tables.css';
import '@/app/css/infobox.css';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { extractToken, fetchJson } from '@/lib/utils';

type Party = { type: 'user'|'bank'|'clearing_account'; name: string; mail?: string; bank?: string; iban?: string } | null;

type BulkRow = {
  id: number;
  account: Party;
  amount: number;
  description: string;
  costCenterLabel?: string;
};

type BulkDetail = {
  id: number;
  date: string;
  type: string; // Anzeigeformat (Auszahlung/Einzug/Einzahlung)
  description: string;
  reference?: string;
  account: Party; // Hauptkonto (User/Bank/Verrechnung)
  attachmentId?: number;
  attachmentUrl?: string;
  rows: BulkRow[];
};

export default function BulkTransactionDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: session, status } = useSession();
  const [data, setData] = useState<BulkDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const json = await fetchJson(`/api/transactions/bulk/${id}`, {
          method: 'GET',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
        });
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
  }, [status, session, id]);

  if (status === 'loading') return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 1000 }}>Lade Sitzung ...</div>;
  if (loading) return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 1000 }}>Lade Daten ...</div>;
  if (error) return <div style={{ color: 'var(--accent)', margin: '2rem auto', maxWidth: 1000 }}>{error}</div>;
  if (!data) return <div style={{ color: 'var(--muted)', margin: '2rem auto', maxWidth: 1000 }}>Keine Daten</div>;

  const renderParty = (p: Party) => {
    if (!p) return <span style={{ color: 'var(--muted)' }}>-</span>;
    if (p.type === 'user') return <span>Nutzer: {p.name}</span>;
    if (p.type === 'bank') return <span>Bankkonto: {p.name}{p.bank ? ` (${p.bank})` : ''}</span>;
    if (p.type === 'clearing_account') return <span>Verrechnungskonto: {p.name}</span>;
    return <span>{p.name}</span>;
  };

  return (
    <div style={{ maxWidth: 1000, margin: '2rem auto', padding: '1rem' }}>
      <h2 style={{ marginBottom: '1.2rem' }}>Sammelüberweisung</h2>

      <div className="kc-infobox" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 6 }}>
          <div style={{ fontWeight: 600 }}>Datum:</div>
          <div>{new Date(data.date).toLocaleString()}</div>
          <div style={{ fontWeight: 600 }}>Art:</div>
          <div>{data.type}</div>
          <div style={{ fontWeight: 600 }}>Konto:</div>
          <div>{renderParty(data.account)}</div>
          <div style={{ fontWeight: 600 }}>Beschreibung:</div>
          <div>{data.description}</div>
          <div style={{ fontWeight: 600 }}>Referenz:</div>
          <div>{data.reference || <span style={{ color: 'var(--muted)' }}>-</span>}</div>
          <div style={{ fontWeight: 600 }}>Beleg:</div>
          <div>
            {data.attachmentUrl ? (
              <a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer">
                <button className="button" style={{ padding: '0.2rem 0.8rem' }}>Beleg herunterladen</button>
              </a>
            ) : <span style={{ color: 'var(--muted)' }}>Kein Beleg</span>}
          </div>
        </div>
      </div>

      <h3 style={{ marginBottom: '0.6rem' }}>Einzelbuchungen</h3>
      <table className="kc-table">
        <thead>
          <tr>
            <th>Konto</th>
            <th>Betrag</th>
            <th>Beschreibung</th>
            <th>Kostenstelle</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>Keine Einzelbuchungen vorhanden</td></tr>
          )}
          {data.rows.map((r) => (
            <tr key={r.id} className="kc-row">
              <td>{renderParty(r.account)}</td>
              <td style={{ color: r.amount < 0 ? '#e11d48' : '#059669', fontWeight: 600 }}>{r.amount.toFixed(2)} €</td>
              <td>{r.description}</td>
              <td>{r.costCenterLabel || <span style={{ color: 'var(--muted)' }}>-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

