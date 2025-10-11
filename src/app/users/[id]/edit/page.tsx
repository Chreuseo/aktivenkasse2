'use client';

import { useSession } from "next-auth/react";
import { useState, useEffect, use } from "react";
import { extractToken, fetchJson } from "@/lib/utils";
import "../../../css/edit-form.css";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    mail: "",
    enabled: true,
    interest: true,
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") return;
    async function loadData() {
      try {
        const token = extractToken(session);
        if (!token) {
          setMessage("❌ Keine Session oder Token gefunden. Bitte neu einloggen.");
          setLoading(false);
          setFormLoading(false);
          return;
        }
        const userJson = await fetchJson(`/api/users/${id}/edit`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        setFormData({
          first_name: userJson.first_name ?? "",
          last_name: userJson.last_name ?? "",
          mail: userJson.mail ?? "",
          enabled: typeof userJson.enabled === "boolean" ? userJson.enabled : true,
          interest: typeof userJson.interest === "boolean" ? userJson.interest : true,
        });
        setFormLoading(false);
      } catch (err: any) {
        setMessage("❌ Fehler beim Laden: " + (err?.message || String(err)));
        setFormLoading(false);
      }
    }
    loadData();
  }, [session, status, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    if (status !== "authenticated") {
      setMessage("❌ Keine Session oder Token gefunden. Bitte neu einloggen.");
      setLoading(false);
      return;
    }
    const token = extractToken(session);
    if (!token) {
      setMessage("❌ Keine Session oder Token gefunden. Bitte neu einloggen.");
      setLoading(false);
      return;
    }
    try {
      await fetchJson(`/api/users/${id}/edit`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });
      setMessage("✅ Änderungen gespeichert!");
    } catch (error: any) {
      setMessage("❌ Fehler: " + (error?.message || String(error)));
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") return <div className="edit-form-container">Lade Session ...</div>;
  if (status === "unauthenticated") return <div className="edit-form-container">Bitte einloggen.</div>;

  return (
    <div className="edit-form-container">
      <h1>Nutzer bearbeiten</h1>
      {formLoading ? (
        <div>Lade Daten ...</div>
      ) : (
        <form onSubmit={handleSubmit} className="edit-form">
          <label>
            Vorname
            <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} required />
          </label>
          <label>
            Nachname
            <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} required />
          </label>
          <label>
            Mailadresse
            <input type="email" name="mail" value={formData.mail} onChange={handleChange} required />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="enabled" checked={formData.enabled} onChange={handleChange} />
            <span>Aktiviert</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="interest" checked={formData.interest} onChange={handleChange} />
            <span>Zinsen erheben</span>
          </label>
          <button className="button" type="submit" disabled={loading}>Speichern</button>
        </form>
      )}
      {message && <p className="edit-message">{message}</p>}
    </div>
  );
}
