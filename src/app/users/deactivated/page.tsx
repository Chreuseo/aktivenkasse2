'use client';

import React, { useEffect, useState } from 'react';
import '@/app/css/tables.css';
import { useSession } from 'next-auth/react';

import { extractToken } from '@/lib/utils';

type DeactivatedUser = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
};

export default function DeactivatedUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<DeactivatedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch('/api/users/deactivated', {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || 'Fehler beim Laden');
        setUsers([]);
      } else {
        setUsers(json);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [session]);

  async function activate(id: number) {
    setLoading(true);
    setError(null);
    try {
      const token = extractToken(session);
      const res = await fetch('/api/users/deactivated', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Fehler beim Aktivieren');
      } else {
        await load();
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="table-center" style={{ padding: '1rem' }}>
      <h2 style={{ marginBottom: 16 }}>Deaktivierte Nutzer</h2>
      {loading && <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: 'var(--accent)', marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Mailadresse</th>
            <th>Details</th>
            <th>Aktivieren</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="kc-row">
              <td>{u.first_name}</td>
              <td>{u.last_name}</td>
              <td>{u.mail}</td>
              <td>
                <button className="button" onClick={() => (window.location.href = `/users/${u.id}`)}>
                  Details
                </button>
              </td>
              <td>
                <button className="button" onClick={() => activate(u.id)} disabled={loading}>
                  Aktivieren
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && !loading && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                Keine deaktivierten Nutzer gefunden
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

