'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken, fetchJson } from '@/lib/utils';
import { DonationRow } from '@/app/types/donation';
import DonationsTable from '@/app/components/DonationsTable';

type UserOption = {
  id: number;
  label: string;
};

function toInputDateValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function DonationsOverviewPage() {
  const { data: session } = useSession();
  const [donations, setDonations] = useState<DonationRow[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const defaultFromTo = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), 0, 1);
    const to = now;
    return { from, to };
  }, []);

  const [dateFrom, setDateFrom] = useState<string>(() => toInputDateValue(defaultFromTo.from));
  const [dateTo, setDateTo] = useState<string>(() => toInputDateValue(defaultFromTo.to));

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const [donationData, userData] = await Promise.all([
          fetchJson('/api/donations?scope=all', {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: 'no-store',
          }),
          fetchJson('/api/users', {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: 'no-store',
          }),
        ]);

        const donationRows = donationData as DonationRow[];
        setDonations(donationRows);

        const usersRaw = Array.isArray(userData) ? userData : [];
        const donationUserIds = new Set<number>(
          donationRows.map((d) => Number(d.userId)).filter((id) => Number.isFinite(id))
        );
        const selectableUsers: UserOption[] = usersRaw
          .filter((u: any) => donationUserIds.has(Number(u.id)))
          .map((u: any) => ({
            id: Number(u.id),
            label: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || `Benutzer #${u.id}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'de'));

        setUsers(selectableUsers);

        setSelectedUserId((prev) =>
          prev && !selectableUsers.some((u) => String(u.id) === prev) ? '' : prev
        );
      } catch (e: any) {
        setError(e?.message || String(e));
        setDonations(null);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  const filteredDonations = useMemo(() => {
    if (!donations) return null;
    if (!selectedUserId) return donations;
    const selected = Number(selectedUserId);
    return donations.filter((d) => d.userId === selected);
  }, [donations, selectedUserId]);

  async function downloadReceipt() {
    setReceiptError(null);
    setReceiptLoading(true);
    try {
      const token = extractToken(session as any);
      if (!token) {
        setReceiptError('Keine Session/Token gefunden. Bitte neu einloggen.');
        return;
      }

      if (!selectedUserId) {
        setReceiptError('Bitte zuerst einen Benutzer auswählen.');
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

      const qs = new URLSearchParams({ from: dateFrom, to: dateTo, userId: selectedUserId });
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

      try {
        const data = await fetchJson('/api/donations?scope=all', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });
        setDonations(data as DonationRow[]);
      } catch (e: any) {
        setReceiptError(e?.message || String(e));
      }
    } catch (e: any) {
      setReceiptError(e?.message || String(e));
    } finally {
      setReceiptLoading(false);
    }
  }

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Zuwendungsbescheide (alle)</h2>

      <div className="kc-panel kc-panel--spaced">
        <div className="kc-filterbar">
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Benutzer</span>
            <select className="kc-input" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              <option value="">Alle Benutzer</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>

          <label className="kc-label-col">
            <span className="kc-fieldlabel">Datum von</span>
            <input className="kc-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="kc-label-col">
            <span className="kc-fieldlabel">Datum bis</span>
            <input className="kc-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          <button className="button" onClick={downloadReceipt} disabled={receiptLoading || !selectedUserId}>
            {receiptLoading ? 'Erstelle ...' : 'Spendenquittung erstellen'}
          </button>

          {receiptError && <div className="kc-error">Fehler: {receiptError}</div>}
        </div>
      </div>

      {loading && <div className="kc-status">Lade Daten ...</div>}
      {error && <div className="kc-error">Fehler beim Laden: {error}</div>}
      {filteredDonations && <DonationsTable donations={filteredDonations} showUser={true} showProcessor={true} />}
    </div>
  );
}
