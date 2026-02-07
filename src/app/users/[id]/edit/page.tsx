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

  const [sepaData, setSepaData] = useState({
    sepa_mandate: false,
    sepa_mandate_date: "", // YYYY-MM-DD
    sepa_mandate_reference: "",
    sepa_iban: "",
    sepa_bic: "",
  });
  const [sepaSaving, setSepaSaving] = useState(false);
  const [sepaMessage, setSepaMessage] = useState<string>("");

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

        // Basisdaten (inkl. Keycloak-Update via /edit)
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

        // SEPA-Felder (kommen aus /api/users/[id])
        const userDetail = await fetchJson(`/api/users/${id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        const u = userDetail?.user ?? {};
        setSepaData({
          sepa_mandate: Boolean(u.sepa_mandate),
          sepa_mandate_date: u.sepa_mandate_date ? String(u.sepa_mandate_date).slice(0, 10) : "",
          sepa_mandate_reference: u.sepa_mandate_reference ?? "",
          sepa_iban: u.sepa_iban ?? "",
          sepa_bic: u.sepa_bic ?? "",
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
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSepaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setSepaData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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

  const saveSepa = async () => {
    setSepaMessage("");
    setSepaSaving(true);

    if (status !== "authenticated") {
      setSepaMessage("❌ Bitte einloggen.");
      setSepaSaving(false);
      return;
    }

    const token = extractToken(session);
    if (!token) {
      setSepaMessage("❌ Keine Session/Token gefunden. Bitte neu einloggen.");
      setSepaSaving(false);
      return;
    }

    try {
      await fetchJson(`/api/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sepa_mandate: Boolean(sepaData.sepa_mandate),
          sepa_mandate_date: sepaData.sepa_mandate_date
            ? new Date(sepaData.sepa_mandate_date + "T00:00:00.000Z").toISOString()
            : null,
          sepa_mandate_reference: sepaData.sepa_mandate_reference,
          sepa_iban: sepaData.sepa_iban,
          sepa_bic: sepaData.sepa_bic,
        }),
      });
      setSepaMessage("✅ SEPA-Daten gespeichert!");
    } catch (e: any) {
      setSepaMessage("❌ Fehler: " + (e?.message || String(e)));
    } finally {
      setSepaSaving(false);
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
        <>
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

          <hr style={{ margin: "1rem 0" }} />

          <form className="edit-form" onSubmit={(e) => { e.preventDefault(); saveSepa(); }}>
            <h2 style={{ margin: 0 }}>SEPA-Mandat</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" name="sepa_mandate" checked={Boolean(sepaData.sepa_mandate)} onChange={handleSepaChange} />
              <span>Mandat aktiv</span>
            </label>
            <label>
              Mandatsdatum
              <input type="date" name="sepa_mandate_date" value={sepaData.sepa_mandate_date} onChange={handleSepaChange} disabled={!sepaData.sepa_mandate} />
            </label>
            <label>
              Mandatsreferenz
              <input type="text" name="sepa_mandate_reference" value={sepaData.sepa_mandate_reference} onChange={handleSepaChange} disabled={!sepaData.sepa_mandate} placeholder="z.B. HV-2026-0001" />
            </label>
            <label>
              IBAN
              <input type="text" name="sepa_iban" value={sepaData.sepa_iban} onChange={handleSepaChange} disabled={!sepaData.sepa_mandate} placeholder="DE..." />
            </label>
            <label>
              BIC (optional)
              <input type="text" name="sepa_bic" value={sepaData.sepa_bic} onChange={handleSepaChange} disabled={!sepaData.sepa_mandate} placeholder="..." />
            </label>

            <button className="button" type="submit" disabled={sepaSaving}>
              {sepaSaving ? "Speichere…" : "SEPA speichern"}
            </button>
            {sepaMessage ? <p className="edit-message">{sepaMessage}</p> : null}
          </form>
        </>
      )}
      {message && <p className="edit-message">{message}</p>}
    </div>
  );
}
