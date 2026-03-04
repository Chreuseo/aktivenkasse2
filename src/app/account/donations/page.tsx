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
      if (!token) {
        setReceiptError('Keine Session/Token gefunden. Bitte neu einloggen.');
        return;
      }

      if (!dateFrom || !dateTo) {
        setReceiptError('Bitte Zeitraum vollständig auswählen (von/bis).');
        return;
      }
      if (dateFrom > dateTo) {
        setReceiptError('Datum von darf nicht nach Datum bis liegen.');
        return;
      }

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
        setReceiptError(msg);
        return;
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

      // Liste nach erfolgreichem Download neu laden, damit "Abgerufen" aktualisiert wird.
      try {
        const data = await fetchJson('/api/donations?scope=mine', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });
        setDonations(data as DonationRow[]);
      } catch {
        // UI-Refresh ist nice-to-have; Download war erfolgreich.
      }
    } catch (e: any) {
      setReceiptError(e?.message || String(e));
    } finally {
      setReceiptLoading(false);
    }
  }

  return (
    <div className="kc-page kc-page--1200">
      <h2 className="kc-page-title">Meine Zuwendungsbescheide</h2>

      <div className="kc-panel kc-panel--spaced">
        <div className="kc-filterbar">
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Datum von</span>
            <input className="kc-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Datum bis</span>
            <input className="kc-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          <button className="button" onClick={downloadReceipt} disabled={receiptLoading}>
            {receiptLoading ? 'Erstelle ...' : 'Spendenquittung erstellen'}
          </button>

          {receiptError && <div className="kc-error">Fehler: {receiptError}</div>}
        </div>
      </div>

      {loading && <div className="kc-status">Lade Daten ...</div>}
      {error && <div className="kc-error">Fehler beim Laden: {error}</div>}
      {donations && <DonationsTable donations={donations} showUser={false} showProcessor={false} />}
    </div>
  );
}
