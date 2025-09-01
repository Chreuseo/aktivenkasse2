'use client';
import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import "@/app/css/tables.css";

type AuthorizationType = 'none' | 'read_own' | 'read_all' | 'write_all';

type Role = {
  id: number;
  name: string | null;
  keycloak_id: string | null;
  userId?: number; // ergänzt für DB-Kompatibilität
  household: AuthorizationType;
  userAuth: AuthorizationType;
  help_accounts: AuthorizationType;
  bank_accounts: AuthorizationType;
  transactions: AuthorizationType;
  advances: AuthorizationType;
};

const AUTH_OPTIONS: AuthorizationType[] = ['none', 'read_own', 'read_all', 'write_all'];
// Friendly Names für Berechtigungs-Enum
const AUTH_OPTION_NAMES: Record<AuthorizationType, string> = {
  none: "Keine",
  read_own: "Eigene",
  read_all: "Alle",
  write_all: "Bearbeiten",
};

export default function RolesPage() {
  const { data: session } = useSession();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [users, setUsers] = useState<{id: number, first_name: string, last_name: string, mail: string}[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // Token aus Session extrahieren
  function getToken() {
    // Token kann je nach NextAuth-Callback unter session.token oder session.user.token liegen
    return (session?.token as string)
      || (session?.user && typeof session.user === 'object' && (session.user as any).token)
      || "";
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch('/api/roles', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error || 'Fehler');
        setRoles([]);
      } else {
        setRoles(json);
      }
    } catch (e: any) {
      setMsg('Ladefehler: ' + (e?.message || String(e)));
      setRoles([]);
    } finally { setLoading(false); }
  }

  async function loadUsers() {
    try {
      const token = getToken();
      const res = await fetch('/api/users', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json)) setUsers(json);
    } catch {}
  }

  useEffect(() => {
    load();
    loadUsers();
  }, [session]);

  async function updateRoleField(id: number, updates: Partial<Role>) {
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch('/api/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, ...updates }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error || 'Fehler');
      } else {
        setRoles(r => r.map(x => x.id === id ? json : x));
        setMsg('Gespeichert');
      }
    } catch (e: any) {
      setMsg('Speicherfehler: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  async function createRole() {
    if (!newName.trim()) { setMsg('Name erforderlich'); return; }
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error || 'Fehler');
      } else {
        setRoles(r => [...r, json]);
        setNewName('');
        setMsg('Rolle angelegt');
      }
    } catch (e: any) {
      setMsg('Anlegen fehlgeschlagen: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  async function createUserRole() {
    if (!selectedUserId) { setMsg('Bitte Nutzer wählen'); return; }
    setLoading(true);
    setMsg(null);
    try {
      const user = users.find(u => u.id === selectedUserId);
      if (!user) { setMsg('Nutzer nicht gefunden'); return; }
      const roleName = `user_${user.id}_${user.first_name}_${user.last_name}`;
      const token = getToken();
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: roleName, userId: user.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error || 'Fehler');
      } else {
        setRoles(r => [...r, json]);
        setSelectedUserId(null);
        setMsg('Nutzerrolle angelegt');
      }
    } catch (e: any) {
      setMsg('Anlegen fehlgeschlagen: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  async function deleteRole(id: number) {
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch('/api/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error || 'Fehler');
      } else {
        setRoles(r => r.filter(x => x.id !== id));
        setMsg('Rolle gelöscht');
      }
    } catch (e: any) {
      setMsg('Löschen fehlgeschlagen: ' + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  function getRoleDisplayName(role: Role, users: {id: number, first_name: string, last_name: string, mail: string}[]): string {
    if (role.userId) {
      const user = users.find(u => u.id === role.userId);
      return user ? `${user.first_name} ${user.last_name}` : "Nutzerrolle";
    }
    if (role.name && role.name.startsWith("aktivenkasse_")) {
      return role.name.replace("aktivenkasse_", "");
    }
    return role.name || "Rolle";
  }

  return (
    <div style={{ maxWidth: 1100, margin: "1.5rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 12 }}>Rollenverwaltung</h2>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <button className="button" onClick={load} disabled={loading}>Aktualisieren</button>
      </div>
      {msg && <div style={{ marginBottom: 12, fontWeight: 600, color: "var(--secondary-color, #facc15)" }}>{msg}</div>}
      <table className="kc-table compact" role="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Keycloak ID</th>
            <th>Nutzer</th>
            <th>Haushalt</th>
            <th>Nutzerverwaltung</th>
            <th>Hilfskonten</th>
            <th>Bankkonten</th>
            <th>Buchungen</th>
            <th>Auslagen</th>
            <th>Löschen</th>
          </tr>
        </thead>
        <tbody>
          {roles.map(r => {
            const user = r.userId ? users.find(u => u.id === r.userId) : null;
            return (
              <tr key={r.id} className="kc-row">
                <td>{getRoleDisplayName(r, users)}</td>
                <td style={{ fontSize: 12, color: "var(--muted, #9aa4b2)" }}>{r.keycloak_id ? "Ja" : "Nein"}</td>
                <td>{user ? `${user.first_name} ${user.last_name} (${user.mail})` : <em>—</em>}</td>
                <td>
                  <select value={r.household} onChange={(e) => updateRoleField(r.id, { household: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.userAuth} onChange={(e) => updateRoleField(r.id, { userAuth: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.help_accounts} onChange={(e) => updateRoleField(r.id, { help_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.bank_accounts} onChange={(e) => updateRoleField(r.id, { bank_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.transactions} onChange={(e) => updateRoleField(r.id, { transactions: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.advances} onChange={(e) => updateRoleField(r.id, { advances: e.target.value as AuthorizationType })} disabled={loading}>
                    {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                  </select>
                </td>
                <td>
                  <button className="button" onClick={() => deleteRole(r.id)} disabled={loading}>Löschen</button>
                </td>
              </tr>
            );
          })}

          {/* Neue Rolle */}
          <tr className="kc-row">
            <td>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Neue Rolle (Name)" />
            </td>
            <td colSpan={7} style={{ display: 'flex', gap: 8 }}>
              <button className="button" onClick={createRole} disabled={loading}>Rolle anlegen</button>
            </td>
            <td></td>
          </tr>
          {/* Nutzerrolle */}
          <tr className="kc-row">
            <td colSpan={2}>
              <select value={selectedUserId ?? ''} onChange={e => setSelectedUserId(Number(e.target.value) || null)}>
                <option value="">Nutzer wählen…</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.mail})</option>
                ))}
              </select>
            </td>
            <td colSpan={6} style={{ display: 'flex', gap: 8 }}>
              <button className="button" onClick={createUserRole} disabled={loading || !selectedUserId}>Nutzerrolle anlegen</button>
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}