'use client';

import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  balance: string | number;
};

export default function UsersOverview() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/users");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Fehler beim Laden");
        setUsers(json);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 16 }}>Nutzerübersicht</h2>
      {error && <div style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Mailadresse</th>
            <th>Kontostand</th>
            <th>Infomail</th>
            <th>Details</th>
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
                <button className="button" disabled>
                  Infomail
                </button>
                {/* TODO: Infomail Funktion */}
              </td>
              <td>
                <button className="button" onClick={() => window.location.href = `/users/${u.id}`}>
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
