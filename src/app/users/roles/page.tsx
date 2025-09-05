'use client';
import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import "@/app/css/tables.css";

type AuthorizationType = 'none' | 'read_own' | 'read_all' | 'write_all';

type Role = {
  id: number;
  name: string | null;
  keycloak_id: string | null;
  userId?: number;
  budget_plan: AuthorizationType; // vorher: household
  userAuth: AuthorizationType;
  clearing_accounts: AuthorizationType;
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

  // Neu: Keycloak-Rollenverwaltung unterhalb der Tabelle
  type KcMember = { id: string; username?: string; email?: string; firstName?: string; lastName?: string; localUserId?: number | null };
  const [selectedKcRoleId, setSelectedKcRoleId] = useState<number | null>(null);
  const [kcMembers, setKcMembers] = useState<KcMember[]>([]);
  const [kcLoading, setKcLoading] = useState(false);
  const [kcMsg, setKcMsg] = useState<string | null>(null);
  const [kcAddUserId, setKcAddUserId] = useState<number | null>(null);

  // Token aus Session extrahieren
  function getToken() {
    // In unseren NextAuth-Callbacks wird das Access Token als session.token gesetzt
    return (session as any)?.token || "";
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

  // Neu: Mitglieder einer Keycloak-Rolle laden
  async function loadKcMembers(roleId: number) {
    if (!roleId) return;
    setKcLoading(true);
    setKcMsg(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/roles/members?roleId=${roleId}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const json = await res.json();
      if (!res.ok) {
        setKcMembers([]);
        setKcMsg(json?.error || 'Fehler beim Laden der Mitglieder');
      } else {
        setKcMembers(Array.isArray(json?.members) ? json.members : []);
      }
    } catch (e: any) {
      setKcMembers([]);
      setKcMsg('Ladefehler: ' + (e?.message || String(e)));
    } finally { setKcLoading(false); }
  }

  // Neu: Nutzer zur Keycloak-Rolle hinzufügen
  async function addKcMember() {
    if (!selectedKcRoleId || !kcAddUserId) { setKcMsg('Bitte Rolle und Nutzer wählen'); return; }
    setKcLoading(true);
    setKcMsg(null);
    try {
      const token = getToken();
      const res = await fetch('/api/roles/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ roleId: selectedKcRoleId, userId: kcAddUserId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKcMsg(json?.error || 'Fehler beim Hinzufügen');
      } else {
        await loadKcMembers(selectedKcRoleId);
        setKcAddUserId(null);
        setKcMsg('Hinzugefügt');
      }
    } catch (e: any) {
      setKcMsg('Fehler: ' + (e?.message || String(e)));
    } finally { setKcLoading(false); }
  }

  // Neu: Nutzer aus Keycloak-Rolle entfernen
  async function removeKcMember(member: KcMember) {
    if (!selectedKcRoleId) return;
    setKcLoading(true);
    setKcMsg(null);
    try {
      const token = getToken();
      const payload: any = { roleId: selectedKcRoleId };
      if (member.localUserId) payload.userId = member.localUserId;
      else payload.userKeycloakId = member.id;
      const res = await fetch('/api/roles/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKcMsg(json?.error || 'Fehler beim Entfernen');
      } else {
        await loadKcMembers(selectedKcRoleId);
        setKcMsg('Entfernt');
      }
    } catch (e: any) {
      setKcMsg('Fehler: ' + (e?.message || String(e)));
    } finally { setKcLoading(false); }
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
    <div className="wide-container">
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
              <th>Budget-Plan</th>
              <th>Nutzerverwaltung</th>
              <th>Verrechnungskonten</th>
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
                  <td>
                    <input
                      type="text"
                      className="kc-input"
                      value={r.name ?? ""}
                      onChange={e => updateRoleField(r.id, { name: e.target.value })}
                      placeholder="Rollenname"
                      disabled={loading}
                    />
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted, #9aa4b2)" }}>{r.keycloak_id ? "Ja" : "Nein"}</td>
                  <td>{user ? `${user.first_name} ${user.last_name} (${user.mail})` : <em>—</em>}</td>
                  <td>
                    <select className="kc-select" value={r.budget_plan} onChange={(e) => updateRoleField(r.id, { budget_plan: e.target.value as AuthorizationType })} disabled={loading}>
                      {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="kc-select" value={r.userAuth} onChange={(e) => updateRoleField(r.id, { userAuth: e.target.value as AuthorizationType })} disabled={loading}>
                      {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="kc-select" value={r.clearing_accounts} onChange={(e) => updateRoleField(r.id, { clearing_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                      {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="kc-select" value={r.bank_accounts} onChange={(e) => updateRoleField(r.id, { bank_accounts: e.target.value as AuthorizationType })} disabled={loading}>
                      {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="kc-select" value={r.transactions} onChange={(e) => updateRoleField(r.id, { transactions: e.target.value as AuthorizationType })} disabled={loading}>
                      {AUTH_OPTIONS.map(o => <option key={o} value={o}>{AUTH_OPTION_NAMES[o]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="kc-select" value={r.advances} onChange={(e) => updateRoleField(r.id, { advances: e.target.value as AuthorizationType })} disabled={loading}>
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
                <input
                  type="text"
                  className="kc-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Neue Rolle (Name)"
                  disabled={loading}
                />
              </td>
              <td colSpan={7} style={{ display: 'flex', gap: 8 }}>
                <button className="button" onClick={createRole} disabled={loading}>Rolle anlegen</button>
              </td>
              <td></td>
            </tr>
            {/* Nutzerrolle */}
            <tr className="kc-row">
              <td colSpan={2}>
                <select className="kc-select" value={selectedUserId ?? ''} onChange={e => setSelectedUserId(Number(e.target.value) || null)}>
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

        {/* Neue Sektion: Keycloak-Rollen-Mitglieder verwalten */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #333' }}>
          <h3 style={{ marginBottom: 12 }}>Keycloak-Rollen-Mitglieder</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <select
              className="kc-select kc-select--md"
              value={selectedKcRoleId ?? ''}
              onChange={async (e) => {
                const v = Number(e.target.value) || null;
                setSelectedKcRoleId(v);
                setKcMembers([]);
                if (v) await loadKcMembers(v);
              }}
              disabled={kcLoading}
            >
              <option value="">Rolle wählen…</option>
              {roles.filter(r => !!r.keycloak_id).map(r => (
                <option key={r.id} value={r.id}>{(r.name || '').replace(/^aktivenkasse_/, '')}</option>
              ))}
            </select>
            <button className="button" onClick={() => selectedKcRoleId ? loadKcMembers(selectedKcRoleId) : undefined} disabled={kcLoading || !selectedKcRoleId}>Mitglieder laden</button>
          </div>
          {kcMsg && <div style={{ marginBottom: 12, fontWeight: 600, color: "var(--secondary-color, #facc15)" }}>{kcMsg}</div>}

          {/* Mitgliederliste */}
          {selectedKcRoleId && (
            <div style={{ marginBottom: 16 }}>
              <table className="kc-table compact">
                <thead>
                  <tr>
                    <th>Nutzer</th>
                    <th>E-Mail</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {kcMembers.length === 0 && (
                    <tr>
                      <td colSpan={3}><em>Keine Mitglieder gefunden</em></td>
                    </tr>
                  )}
                  {kcMembers.map(m => {
                    const local = m.localUserId ? users.find(u => u.id === m.localUserId) : undefined;
                    const name = local ? `${local.first_name} ${local.last_name}` : (m.firstName || m.lastName ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : m.username || m.email || m.id);
                    const email = local ? local.mail : (m.email || '');
                    return (
                      <tr key={m.id}>
                        <td>{name}</td>
                        <td>{email}</td>
                        <td>
                          <button className="button" onClick={() => removeKcMember(m)} disabled={kcLoading}>Entfernen</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Hinzufügen */}
          {selectedKcRoleId && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="kc-select kc-select--md kc-select--fluid" value={kcAddUserId ?? ''} onChange={e => setKcAddUserId(Number(e.target.value) || null)} disabled={kcLoading}>
                <option value="">Nutzer wählen…</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.mail})</option>
                ))}
              </select>
              <button className="button" onClick={addKcMember} disabled={kcLoading || !kcAddUserId}>Zur Rolle hinzufügen</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}