"use client";
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken } from '@/lib/utils';
import '../../css/forms.css';

interface SimpleItem { id: number; date: string; description: string; hasAttachment?: boolean; accountType?: 'user' | 'bank' | 'clearing_account' | null; accountName?: string }

export default function AttachmentUploadPage() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [targetId, setTargetId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [txOptions, setTxOptions] = useState<SimpleItem[]>([]);
  const [bulkOptions, setBulkOptions] = useState<SimpleItem[]>([]);

  const token = extractToken(session);

  function fmtDate(iso: string) {
    try { return iso.slice(0,10); } catch { return iso; }
  }

  const typeToLabel = (t?: string | null) => {
    if (t === 'user') return 'Nutzer';
    if (t === 'bank') return 'Bankkonto';
    if (t === 'clearing_account') return 'Verrechnungskonto';
    return '';
  };

  // Listen laden
  useEffect(() => {
    if (!token) return; // ohne Token nicht laden
    const controller = new AbortController();
    async function load() {
      setListLoading(true);
      try {
        if (mode === 'single' && txOptions.length === 0) {
          const r = await fetch('/api/transactions/list?limit=500', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          if (r.ok) {
            const j = await r.json();
            setTxOptions(Array.isArray(j) ? j : []);
          }
        }
        if (mode === 'bulk' && bulkOptions.length === 0) {
          const r2 = await fetch('/api/transactions/bulk/list?limit=500', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
            if (r2.ok) {
              const j2 = await r2.json();
              setBulkOptions(Array.isArray(j2) ? j2 : []);
            }
        }
      } catch {/* ignore */} finally {
        setListLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [mode, token, txOptions.length, bulkOptions.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!targetId) {
      setMessage('❌ Bitte eine Transaktion auswählen');
      return;
    }
    if (!file) {
      setMessage('❌ Datei auswählen');
      return;
    }
    const idNum = Number(targetId);
    if (!idNum || isNaN(idNum) || idNum <= 0) {
      setMessage('❌ Ungültige Auswahl');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('attachment', file);
      const url = mode === 'bulk'
        ? `/api/transactions/bulk/${idNum}/attach`
        : `/api/transactions/${idNum}/attach`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      let json: any = {};
      try { json = await res.json(); } catch {}
      if (!res.ok) {
        setMessage('❌ Upload fehlgeschlagen' + (json.error ? `: ${json.error}` : ''));
      } else {
        setMessage('✅ Beleg hochgeladen (Attachment ID ' + (json.attachmentId ?? '?') + ')');
        setFile(null);
        setTargetId('');
        const inp = document.getElementById('file-input') as HTMLInputElement | null;
        if (inp) inp.value = '';
      }
    } catch (e: any) {
      setMessage('❌ Fehler: ' + (e?.message || 'Unbekannt'));
    } finally {
      setLoading(false);
    }
  };

  const currentOptions = mode === 'single' ? txOptions : bulkOptions;

  return (
    <div className="form-container" style={{ maxWidth: '620px' }}>
      <h1>Beleg nachträglich hochladen</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Modus
          <select
            value={mode}
            onChange={e => { setMode(e.target.value as 'single' | 'bulk'); setTargetId(''); }}
            className="form-select form-select-max"
            style={{ maxWidth: '220px' }}
          >
            <option value="single">Einzeltransaktion</option>
            <option value="bulk">Sammeltransaktion</option>
          </select>
        </label>
        <label>
          {mode === 'bulk' ? 'Sammeltransaktion wählen' : 'Transaktion wählen'}
          <select
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className="form-select form-select-max"
            required
            disabled={listLoading || !token}
            style={{ maxWidth: '100%' }}
          >
            <option value="">{listLoading ? 'Lade...' : 'Bitte wählen'}</option>
            {currentOptions.map(o => {
              const typeLabel = typeToLabel(o.accountType);
              const namePart = o.accountName ? ` | ${o.accountName}` : '';
              return (
                <option key={o.id} value={o.id}>{`${o.id} | ${fmtDate(o.date)} | ${typeLabel}${namePart}${typeLabel || namePart ? ' | ' : ''}${o.description}${o.hasAttachment ? ' (ersetzen)' : ''}`}</option>
              );
            })}
          </select>
        </label>
        <label>
          Datei (Bild oder PDF)
          <input
            id="file-input"
            type="file"
            accept="image/*,application/pdf"
            onChange={e => setFile(e.target.files?.[0] || null)}
            required
            className="form-file-upload"
          />
        </label>
        <p style={{ fontSize: '0.85rem', color: '#666' }}>
          Hinweis: Bei Sammeltransaktionen wird der Beleg auch bei allen zugehörigen Einzeltransaktionen hinterlegt.
        </p>
        <button type="submit" disabled={loading || listLoading}>{loading ? 'Lädt…' : 'Hochladen'}</button>
      </form>
      {message && <p className="message" style={{ whiteSpace: 'pre-line' }}>{message}</p>}
    </div>
  );
}
