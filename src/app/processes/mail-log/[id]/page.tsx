'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import '@/app/css/tables.css';

function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || '';
}

type MailDetail = {
  id: number;
  subject: string;
  body: string;
  sentAt: string;
  addressedTo: string;
  attachment?: string | null;
  user: { id: number; first_name: string; last_name: string } | null;
};

export default function MailLogDetailPage() {
  const { data: session } = useSession();
  const params = useParams() as { id?: string };
  const id = params?.id ?? '';
  const [item, setItem] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch(`/api/mails/${id}` , {
          method: 'GET',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || 'Fehler beim Laden');
          setItem(null);
        } else {
          setItem(json);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setItem(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session, id]);

  return (
    <div className="table-center" style={{ padding: '1rem', maxWidth: 900 }}>
      <h2 style={{ margin: '0 0 1rem 0' }}>Mail-Details</h2>
      <div style={{ marginBottom: '1rem' }}>
        <button className="button" onClick={() => history.back()}>Zurück</button>
      </div>
      {loading && <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: 'var(--accent)', marginBottom: 12 }}>{error}</div>}
      {item && (
        <table className="kc-table" role="table">
          <tbody>
            <tr>
              <th>Datum</th>
              <td>{item.sentAt ? new Date(item.sentAt).toLocaleString('de-DE') : ''}</td>
            </tr>
            <tr>
              <th>Betreff</th>
              <td>{item.subject}</td>
            </tr>
            <tr>
              <th>Nutzer</th>
              <td>{item.user ? `${item.user.first_name} ${item.user.last_name}` : '—'}</td>
            </tr>
            <tr>
              <th>Empfänger</th>
              <td>{item.addressedTo}</td>
            </tr>
            <tr className="kc-entry-end">
              <th>Body</th>
              <td>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  {item.body}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {!loading && !error && !item && (
        <div style={{ color: 'var(--muted)' }}>Kein Eintrag gefunden</div>
      )}
    </div>
  );
}
