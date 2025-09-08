'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken } from '@/lib/utils';
import '@/app/css/forms.css';

// Unterstützte Typen für die UI
// user => Nutzer, clearing => Verrechnungskonto, bank => Bankkonto, household => Haushalt (TODO)
type ExportType = 'user' | 'clearing' | 'bank' | 'household';

type Option = { id: number; label: string };

type UserItem = { id: number; first_name: string; last_name: string };
type ClearingItem = { id: number; name: string };
type BankItem = { id: number; name: string; bank?: string };

export default function ExportPage() {
  const { data: session } = useSession();
  const token = useMemo(() => extractToken(session as any), [session]);

  const [type, setType] = useState<ExportType>('user');
  const [options, setOptions] = useState<Option[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Optionen je nach Typ laden
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingOptions(true);
      setError(null);
      setMessage(null);
      setOptions([]);
      setSelectedId('');
      try {
        if (type === 'household') {
          // Haushalt noch offen => keine Optionen
          setOptions([]);
          return;
        }
        const endpoint = type === 'user' ? '/api/users' : type === 'clearing' ? '/api/clearing-accounts' : '/api/bank-accounts';
        const res = await fetch(endpoint, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
        if (cancelled) return;
        if (type === 'user') {
          const users = json as UserItem[];
          setOptions(users.map(u => ({ id: u.id, label: `${u.first_name} ${u.last_name}` })));
        } else if (type === 'clearing') {
          const items = json as ClearingItem[];
          setOptions(items.map(c => ({ id: c.id, label: c.name })));
        } else if (type === 'bank') {
          const items = json as BankItem[];
          setOptions(items.map(b => ({ id: b.id, label: `${b.name}${b.bank ? ` (${b.bank})` : ''}` })));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [type, token]);

  const canPickDates = type === 'user' || type === 'clearing' || type === 'bank';

  async function onDownload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (type === 'household') {
      setMessage('Haushalt-Export folgt (TODO).');
      return;
    }
    if (!selectedId || typeof selectedId !== 'number') {
      setError('Bitte wähle ein Element aus.');
      return;
    }
    if (from && to && new Date(from) > new Date(to)) {
      setError('Der Zeitraum ist ungültig: Von ist nach Bis.');
      return;
    }

    const qs = new URLSearchParams({ type, id: String(selectedId) });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);

    try {
      setDownloading(true);
      const res = await fetch(`/api/export/transactions?${qs.toString()}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        const maybeJson = await res.clone().json().catch(() => null);
        throw new Error(maybeJson?.error || `${res.status} ${res.statusText}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Dateiname aus Header extrahieren
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || 'Export.pdf';

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage(`Export heruntergeladen: ${filename}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="form-container" style={{ maxWidth: 820 }}>
      <h2 style={{ marginBottom: '1rem' }}>Export</h2>
      <form className="form" onSubmit={onDownload}>
        <label>
          Was möchtest du exportieren?
          <select className="form-select form-select-max" value={type} onChange={e => setType(e.target.value as ExportType)}>
            <option value="user">Nutzer</option>
            <option value="clearing">Verrechnungskonto</option>
            <option value="bank">Bankkonto</option>
            <option value="household">Haushalt (TODO)</option>
          </select>
        </label>

        {/* Auswahl je nach Typ */}
        {type !== 'household' && (
          <label>
            Auswahl
            <select
              className="form-select form-select-max"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : '')}
              disabled={loadingOptions}
            >
              <option value="">Bitte wählen</option>
              {options.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        )}

        {/* Zeitraum nur für user/clearing/bank */}
        {canPickDates && (
          <div className="form-accounts-row">
            <label className="form-account-col">
              Von (inkl.)
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="form-account-col">
              Bis (inkl.)
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
        )}

        <button type="submit" disabled={downloading || (type !== 'household' && !selectedId)}>
          {downloading ? 'Erzeuge PDF…' : 'PDF exportieren'}
        </button>

        {message && <div className="message">{message}</div>}
        {error && <div className="message" style={{ color: '#ef4444' }}>{error}</div>}

        {type === 'household' && (
          <div className="message">Haushalt-Export ist noch offen (TODO).</div>
        )}
      </form>
    </div>
  );
}

