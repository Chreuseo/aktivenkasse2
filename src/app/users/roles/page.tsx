'use client';
import React, { useEffect, useState } from "react";
import "@/app/css/tables.css";

type AuthorizationType = 'none' | 'read_own' | 'read_all' | 'write_all';

type Role = {
  id: number;
  name: string | null;
  keycloak_id: string | null;
  household: AuthorizationType;
  userAuth: AuthorizationType;
  help_accounts: AuthorizationType;
  bank_accounts: AuthorizationType;
  transactions: AuthorizationType;
  advances: AuthorizationType;
};

const AUTH_OPTIONS: AuthorizationType[] = ['none', 'read_own', 'read_all', 'write_all'];

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/roles');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Fehler');
      setRoles(json);
    } catch (e: any) {
      setMsg('Ladefehler: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function updateRoleField(id: number, updates: Partial<Role>) {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Fehler');
      setRoles(r => r.map(x => x.id === id ? json : x));
      setMsg('Gespeichert');
    } catch (e: any) {
      setMsg('Speicherfehler: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  async function createRole() {
    if (!newName.trim()) { setMsg('Name erforderlich'); return; }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Fehler');
      setRoles(r => [...r, json]);
      setNewName('');
      setMsg('Rolle angelegt');
    } catch (e: any) {
      setMsg('Anlegen fehlgeschlagen: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "1.5rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 12 }}>Rollenverwaltung</h2>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <button onClick={load} disabled={loading}>Aktualisieren</button>
      </div>
      {msg && <div style={{ marginBottom: 12, fontWeight: 600, color: "var(--secondary-color, #facc15)" }}>{msg}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Keycloak ID</th>
            <th>Household</th>
            <th>User Auth</th>
            <th>Help Accounts</th>
            <th>Bank Accounts</th>
            <th>Transactions</th>
            <th>Advances</th>
          </tr>
        </thead>
        <tbody>
          {roles.map(r => (
            <tr key={r.id} className="kc-row">
              <td>{r.name || <em>ohne Namen</em>}</td>
              <td style={{ fontSize: 12, color: "var(--muted, #9aa4b2)" }}>{r.keycloak_id || <em>—</em>}</td>
              <td>
                <select value={r.household} onChange={(e) => updateRoleField(r.id, { household: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select value={r.userAuth} onChange={(e) => updateRoleField(r.id, { userAuth: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select value={r.help_accounts} onChange={(e) => updateRoleField(r.id, { help_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select value={r.bank_accounts} onChange={(e) => updateRoleField(r.id, { bank_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select value={r.transactions} onChange={(e) => updateRoleField(r.id, { transactions: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select value={r.advances} onChange={(e) => updateRoleField(r.id, { advances: e.target.value as AuthorizationType })} disabled={loading}>
                  {AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
            </tr>
          ))}

          {/* Neue Rolle */}
          <tr className="kc-row">
            <td>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Neue Rolle (Name)" />
            </td>
            <td colSpan={7} style={{ display: 'flex', gap: 8 }}>
              <button onClick={createRole} disabled={loading}>Rolle anlegen</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}