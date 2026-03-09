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
    <div className="kc-page">
      <h2 className="kc-page-title">Mail-Details</h2>
      <div className="u-mb-3">
        <button className="button" onClick={() => history.back()}>Zurück</button>
      </div>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      {item && (
        <table className="kc-table kc-table--fixed" role="table">
          <tbody>
            <tr>
              <th className="kc-th--w-160 kc-th--nowrap">Datum</th>
              <td className="kc-td--break">{item.sentAt ? new Date(item.sentAt).toLocaleString('de-DE') : ''}</td>
            </tr>
            <tr>
              <th className="kc-th--nowrap">Betreff</th>
              <td className="kc-td--break">{item.subject}</td>
            </tr>
            <tr>
              <th className="kc-th--nowrap">Nutzer</th>
              <td className="kc-td--break">{item.user ? `${item.user.first_name} ${item.user.last_name}` : '—'}</td>
            </tr>
            <tr>
              <th className="kc-th--nowrap">Empfänger</th>
              <td className="kc-td--break">{item.addressedTo}</td>
            </tr>
            <tr className="kc-entry-end">
              <th className="kc-th--nowrap">Body</th>
              <td>
                <div className="kc-prewrap-anywhere">
                  {item.body}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {!loading && !error && !item && (
        <div className="kc-status">Kein Eintrag gefunden</div>
      )}
    </div>
  );
}
