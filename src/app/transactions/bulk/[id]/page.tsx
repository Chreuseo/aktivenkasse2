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

  if (status === 'loading') return <div className="kc-page kc-status">Lade Sitzung ...</div>;
  if (loading) return <div className="kc-page kc-status">Lade Daten ...</div>;
  if (error) return <div className="kc-page kc-error">{error}</div>;
  if (!data) return <div className="kc-page kc-status">Keine Daten</div>;

  const renderParty = (p: Party) => {
    if (!p) return <span className="kc-muted-dash">-</span>;
    if (p.type === 'user') return <span>Nutzer: {p.name}</span>;
    if (p.type === 'bank') return <span>Bankkonto: {p.name}{p.bank ? ` (${p.bank})` : ''}</span>;
    if (p.type === 'clearing_account') return <span>Verrechnungskonto: {p.name}</span>;
    return <span>{p.name}</span>;
  };

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Sammelüberweisung</h2>

      <div className="kc-infobox kc-infobox--spaced">
        <div className="kc-kv-grid">
          <div className="kc-kv-key">Datum:</div>
          <div>{new Date(data.date).toLocaleString()}</div>
          <div className="kc-kv-key">Art:</div>
          <div>{data.type}</div>
          <div className="kc-kv-key">Konto:</div>
          <div>{renderParty(data.account)}</div>
          <div className="kc-kv-key">Beschreibung:</div>
          <div>{data.description}</div>
          <div className="kc-kv-key">Referenz:</div>
          <div>{data.reference || <span className="kc-muted-dash">-</span>}</div>
          <div className="kc-kv-key">Beleg:</div>
          <div>
            {data.attachmentUrl ? (
              <a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer">
                <button className="button kc-btn--compact">Beleg herunterladen</button>
              </a>
            ) : <span className="kc-muted-dash">Kein Beleg</span>}
          </div>
        </div>
      </div>

      <h3 className="kc-section-title">Einzelbuchungen</h3>
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
            <tr><td colSpan={4} className="kc-cell--center kc-cell--muted">Keine Einzelbuchungen vorhanden</td></tr>
          )}
          {data.rows.map((r) => (
            <tr key={r.id} className="kc-row">
              <td>{renderParty(r.account)}</td>
              <td className={r.amount < 0 ? 'kc-amount-neg' : 'kc-amount-pos'}>{r.amount.toFixed(2)} €</td>
              <td>{r.description}</td>
              <td>{r.costCenterLabel || <span className="kc-muted-dash">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

