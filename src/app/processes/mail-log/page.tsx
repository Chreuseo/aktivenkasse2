'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import '@/app/css/tables.css';

function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || '';
}

type MailListItem = {
  id: number;
  subject: string;
  sentAt: string;
  user: { id: number; first_name: string; last_name: string } | null;
};

export default function MailLogPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch('/api/mails', {
          method: 'GET',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || 'Fehler beim Laden');
          setItems([]);
        } else {
          setItems(json);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  return (
    <div className="table-center" style={{ padding: '1rem' }}>
      <h2 style={{ margin: '0 0 1rem 0' }}>Mail-Log</h2>
      {loading && <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: 'var(--accent)', marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Betreff</th>
            <th>Nutzer</th>
            <th>Öffnen</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className="kc-row">
              <td>{m.sentAt ? new Date(m.sentAt).toLocaleString('de-DE') : ''}</td>
              <td>{m.subject}</td>
              <td>{m.user ? `${m.user.first_name} ${m.user.last_name}` : '—'}</td>
              <td>
                <button className="button" onClick={() => (window.location.href = `/processes/mail-log/${m.id}`)}>
                  Öffnen
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && !loading && (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                Keine Mails gefunden
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

