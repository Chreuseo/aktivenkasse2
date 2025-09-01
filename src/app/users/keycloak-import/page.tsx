// Datei: src/app/users/keycloak-import/page.tsx
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

type Row = {
  keycloak_id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "new" | "changed" | "same";
  diffs: { first_name: null | { from: string; to: string }; last_name: null | { from: string; to: string }; mail: null | { from: string; to: string } };
};

export default function KeycloakImportPage() {
  const { data: session } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function getToken() {
    return extractToken(session);
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch("/api/keycloak-sync", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      if (Array.isArray(json)) {
        setRows(json);
        setSelected({});
      } else {
        setRows([]);
        setMsg(json?.error || "Fehler beim Laden der Daten");
      }
    } catch (e: any) {
      setRows([]);
      setMsg("Fehler beim Laden: " + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function toggle(id: string) {
    setSelected(s => ({ ...s, [id]: !s[id] }));
  }
  function toggleAll() {
    const all = rows.reduce((acc, r) => { acc[r.keycloak_id] = true; return acc; }, {} as Record<string,boolean>);
    const anySelected = Object.values(selected).some(Boolean);
    setSelected(anySelected ? {} : all);
  }

  async function importSelected() {
    const ids = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
    if (!ids.length) { setMsg("Keine Einträge ausgewählt."); return; }
    setLoading(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch("/api/keycloak-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids })
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg("Fehler: " + (json?.error || "unbekannt"));
      } else {
        setMsg(`Import fertig. erstellt: ${json.created?.length || 0}, aktualisiert: ${json.updated?.length || 0}`);
        await load();
      }
    } catch (e: any) {
      setMsg("Import-Fehler: " + (e?.message || String(e)));
    } finally { setLoading(false); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "1.5rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 12 }}>Keycloak Import</h2>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <button className="button" onClick={load} disabled={loading}>Aktualisieren</button>
        <button className="button" onClick={toggleAll} disabled={loading}>Alle auswählen/abwählen</button>
        <button className="button" onClick={importSelected} disabled={loading}>Ausgewählte importieren</button>
      </div>
      {msg && <div style={{ marginBottom: 12, fontWeight: 600, color: "var(--secondary-color, #facc15)" }}>{msg}</div>}
      <table className="kc-table" role="table">
        <thead>
          <tr>
            <th className="kc-checkbox"><input type="checkbox" onChange={toggleAll} checked={rows.length>0 && Object.keys(selected).length>0 && rows.every(r=>selected[r.keycloak_id])} /></th>
            <th>Benutzername / E-Mail</th>
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.keycloak_id} className="kc-row">
              <td className="kc-checkbox">
                <input type="checkbox" checked={!!selected[r.keycloak_id]} onChange={() => toggle(r.keycloak_id)} />
              </td>
              <td>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <strong>{r.username}</strong>
                  <span style={{ fontSize: 12, color: "var(--muted, #9aa4b2)" }}>
                    {r.status === "changed" && r.diffs.mail ? (
                      <span className="kc-diff changed"><small>alt: {r.diffs.mail.from}</small>neu: {r.diffs.mail.to}</span>
                    ) : (
                      <span>{r.email}</span>
                    )}
                  </span>
                </div>
              </td>
              <td>
                {r.diffs.first_name ? (
                  <span className="kc-diff changed"><small>{r.diffs.first_name.from}</small>{r.diffs.first_name.to}</span>
                ) : <span>{r.firstName}</span>}
              </td>
              <td>
                {r.diffs.last_name ? (
                  <span className="kc-diff changed"><small>{r.diffs.last_name.from}</small>{r.diffs.last_name.to}</span>
                ) : <span>{r.lastName}</span>}
              </td>
              <td>
                <span className={`kc-badge ${r.status}`}>{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}