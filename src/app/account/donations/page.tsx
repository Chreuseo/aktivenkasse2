'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken, fetchJson } from '@/lib/utils';
import { DonationRow } from '@/app/types/donation';
import DonationsTable from '@/app/components/DonationsTable';

function toInputDateValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function MyDonationsPage() {
  const { data: session } = useSession();
  const [donations, setDonations] = useState<DonationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultFromTo = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), 0, 1);
    const to = now;
    return { from, to };
  }, []);

  const [dateFrom, setDateFrom] = useState<string>(() => toInputDateValue(defaultFromTo.from));
  const [dateTo, setDateTo] = useState<string>(() => toInputDateValue(defaultFromTo.to));
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const data = await fetchJson('/api/donations?scope=mine', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        setDonations(data as DonationRow[]);
      } catch (e: any) {
        setError(e?.message || String(e));
        setDonations(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  async function downloadReceipt() {
    setReceiptError(null);
    setReceiptLoading(true);
    try {
      const token = extractToken(session as any);
      if (!token) throw new Error('Keine Session/Token gefunden. Bitte neu einloggen.');

      if (!dateFrom || !dateTo) throw new Error('Bitte Zeitraum vollständig auswählen (von/bis).');
      if (dateFrom > dateTo) throw new Error('Datum von darf nicht nach Datum bis liegen.');

      const qs = new URLSearchParams({ from: dateFrom, to: dateTo });
      const res = await fetch(`/api/donations/receipt?${qs.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });

      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
      const filename = m ? decodeURIComponent(m[1]) : `Spendenquittung_${dateFrom}_${dateTo}.pdf`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setReceiptError(e?.message || String(e));
    } finally {
      setReceiptLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '1rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>Meine Zuwendungsbescheide</h2>

      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'end',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          padding: '0.75rem',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--card, transparent)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum von</label>
          <input className="kc-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum bis</label>
          <input className="kc-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <button className="kc-button" onClick={downloadReceipt} disabled={receiptLoading}>
          {receiptLoading ? 'Erstelle ...' : 'Spendenquittung erstellen'}
        </button>

        {receiptError && <div style={{ color: 'var(--error)' }}>Fehler: {receiptError}</div>}
      </div>

      {loading && <div style={{ color: 'var(--muted)' }}>Lade Daten ...</div>}
      {error && <div>Fehler beim Laden: {error}</div>}
      {donations && <DonationsTable donations={donations} showUser={false} showProcessor={false} />}
    </div>
  );
}
