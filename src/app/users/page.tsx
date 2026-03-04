'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";
import { useSession } from "next-auth/react";

// Utility für Token-Extraktion
function extractToken(session: any): string {
  return (session?.token as string)
    || (session?.user && typeof session.user === 'object' && (session.user as any).token)
    || "";
}

type User = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: string | number;
};

export default function UsersOverview() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session);
        const res = await fetch("/api/users", {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Fehler beim Laden");
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
    load();
  }, [session]);

  async function sendInfoMail(u: User) {
    if (!u?.id) return;
    setActionMsg(null);
    setActionError(null);
    setSendingId(u.id);
    try {
      const token = extractToken(session);
      const res = await fetch("/api/mails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recipients: { type: "user", ids: [u.id] } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data?.error || `Fehler ${res.status}`);
        return;
      }
      setActionMsg(`Infomail an ${u.first_name} ${u.last_name} (${u.mail}) versendet (${data.success}/${data.total} erfolgreich).`);
    } catch (e: any) {
      setActionError(e?.message || "Fehler beim Senden");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="kc-page">
      <h2 className="kc-page-title">Nutzerübersicht</h2>
      {loading && <div className="kc-status kc-status--spaced">Lade Daten ...</div>}
      {error && <div className="kc-error kc-status--spaced">{error}</div>}
      {actionMsg && <div className="message kc-preline u-mb-2">{actionMsg}</div>}
      {actionError && <div className="message kc-message--error u-mb-2">{actionError}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Mailadresse</th>
            <th>Kontostand</th>
            <th>Infomail</th>
            <th>Details</th>
            <th>Bearbeiten</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="kc-row">
              <td>{u.first_name}</td>
              <td>{u.last_name}</td>
              <td>{u.mail}</td>
              <td>{typeof u.balance === "string" ? u.balance : Number(u.balance).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</td>
              <td>
                <button className="button" onClick={() => sendInfoMail(u)} disabled={sendingId === u.id}>
                  {sendingId === u.id ? 'Senden…' : 'Infomail'}
                </button>
              </td>
              <td>
                <button className="button" onClick={() => window.location.href = `/users/${u.id}`}>
                  Details
                </button>
              </td>
              <td>
                <button className="button" onClick={() => window.location.href = `/users/${u.id}/edit`}>
                  Bearbeiten
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && !loading && (
            <tr><td colSpan={7} className="kc-cell--center kc-cell--muted">Keine Nutzer gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
