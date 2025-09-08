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
        throw new Error(data?.error || `Fehler ${res.status}`);
      }
      setActionMsg(`Infomail an ${u.first_name} ${u.last_name} (${u.mail}) versendet (${data.success}/${data.total} erfolgreich).`);
    } catch (e: any) {
      setActionError(e?.message || "Fehler beim Senden");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 16 }}>Nutzerübersicht</h2>
      {loading && <div style={{ color: "var(--muted)", marginBottom: 12 }}>Lade Daten ...</div>}
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      {actionMsg && <div className="message" style={{ marginBottom: 12, whiteSpace: 'pre-line' }}>{actionMsg}</div>}
      {actionError && <div className="message" style={{ marginBottom: 12, color: '#ef4444' }}>{actionError}</div>}
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
            <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Nutzer gefunden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
