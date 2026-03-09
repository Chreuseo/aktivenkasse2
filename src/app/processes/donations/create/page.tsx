'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken, fetchJson } from '@/lib/utils';
import DonationCreateTable from '@/app/components/DonationCreateTable';
import { DonationCreateCandidate, DonationCreateRequestRow } from '@/app/types/donation';

export default function DonationCreateOverviewPage() {
  const { data: session } = useSession();

  const [negativeOnly, setNegativeOnly] = useState(false);
  const [rows, setRows] = useState<DonationCreateCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const token = extractToken(session as any);
      const data = await fetchJson(`/api/donations/candidates?negative=${negativeOnly ? 'true' : 'false'}` , {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      const list = data as DonationCreateCandidate[];
      setRows(list);
      setSelected(new Set());
      // Prefill descriptions map
      const d: Record<number, string> = {};
      for (const r of list) d[r.transactionId] = r.description;
      setDescriptions(d);
    } catch (e: any) {
      setError(e?.message || String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, negativeOnly]);

  const selectedCount = selected.size;

  const selectedRowsPayload: DonationCreateRequestRow[] = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => selected.has(r.transactionId))
      .map((r) => ({
        transactionId: r.transactionId,
        description: descriptions[r.transactionId] ?? r.description,
        type: 'financial',
      }));
  }, [rows, selected, descriptions]);

  function toggleSelected(transactionId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });
  }

  function toggleAll(nextChecked: boolean) {
    if (!rows) return;
    setSelected(() => {
      if (!nextChecked) return new Set();
      return new Set(rows.map((r) => r.transactionId));
    });
  }

  function changeDescription(transactionId: number, value: string) {
    setDescriptions((prev) => ({ ...prev, [transactionId]: value }));
  }

  async function createDonations() {
    if (selectedCount === 0) {
      setMessage('Bitte mindestens eine Transaktion auswählen.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const token = extractToken(session as any);
      const res = await fetchJson('/api/donations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rows: selectedRowsPayload }),
      });

      const createdCount = Array.isArray(res?.created) ? res.created.length : 0;
      const skippedCount = Array.isArray(res?.skipped) ? res.skipped.length : 0;
      setMessage(`Erzeugt: ${createdCount}, übersprungen: ${skippedCount}`);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="kc-page">
      <h2 className="kc-page-title kc-page-title--tight">Zuwendungsbescheide erstellen</h2>

      <div className="kc-inline-controls u-mb-3">
        <label className="kc-checkline">
          <input
            type="checkbox"
            checked={negativeOnly}
            onChange={(e) => setNegativeOnly(e.target.checked)}
          />
          negative Konten anzeigen
        </label>

        <div className="kc-status">
          {rows ? `${rows.length} Einträge` : ''}
        </div>
      </div>

      {loading && <div className="kc-status">Lade Daten ...</div>}
      {error && <div className="kc-error u-mb-3">Fehler: {error}</div>}
      {message && <div className="message u-mb-3">{message}</div>}

      {rows && (
        <DonationCreateTable
          rows={rows}
          selected={selected}
          onToggleSelectedAction={toggleSelected}
          onToggleAllAction={toggleAll}
          descriptions={descriptions}
          onChangeDescriptionAction={changeDescription}
        />
      )}

      {negativeOnly && (
        <div className="kc-panel kc-panel--spaced kc-warning">
          Bitte Zahlungseingänge sorgfältig prüfen.
        </div>
      )}

      <div className="kc-inline-controls kc-inline-controls--between u-mt-2">
        <div className="kc-status">{selectedCount} ausgewählt</div>
        <button className="button" onClick={createDonations} disabled={submitting || loading || selectedCount === 0}>
          {submitting ? 'Erzeuge ...' : 'erzeugen'}
        </button>
      </div>
    </div>
  );
}
