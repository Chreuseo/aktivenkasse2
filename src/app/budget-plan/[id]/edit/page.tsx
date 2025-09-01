"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, use } from "react";
import { extractToken, fetchJson } from "@/app/lib/utils";
import type { BudgetPlanFormData } from "@/app/types/budgetPlan";
import "../../../css/edit-form.css";

const budgetPlanStates = [
  { value: "draft", label: "Entwurf" },
  { value: "default", label: "Standard" },
  { value: "active", label: "Aktiv" },
  { value: "closed", label: "Geschlossen" },
];

export default function EditBudgetPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const [formData, setFormData] = useState<BudgetPlanFormData>({
    name: "",
    description: "",
    state: "draft",
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
        const planJson = await fetchJson(`/api/budget-plan/${id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        setFormData({
          name: planJson.name ?? "",
          description: planJson.description ?? "",
          state: planJson.state ?? "draft",
        });
        setFormLoading(false);
      } catch (err: any) {
        setMessage("❌ Fehler beim Laden: " + err.message);
      }
    }
    loadData();
  }, [session, status, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
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
      await fetchJson(`/api/budget-plan/${id}/edit`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          state: formData.state,
        }),
      });
      setMessage("✅ Änderungen gespeichert!");
    } catch (error: any) {
      setMessage("❌ Fehler: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") return <div className="edit-form-container">Lade Session ...</div>;
  if (status === "unauthenticated") return <div className="edit-form-container">Bitte einloggen.</div>;

  return (
    <div className="edit-form-container">
      <h1>Haushaltsplan bearbeiten</h1>
      {formLoading ? (
        <div>Lade Daten ...</div>
      ) : (
        <form onSubmit={handleSubmit} className="edit-form">
          <label>
            Name
            <input type="text" name="name" value={formData.name} onChange={handleChange} required />
          </label>
          <label>
            Beschreibung <span className="desc-optional">(optional)</span>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              className="edit-form-description"
              placeholder="Beschreibe den Haushaltsplan, z.B. Zweck, Zeitraum oder Besonderheiten ..."
            />
          </label>
          <label>
            Status
            <select name="state" value={formData.state} onChange={handleChange} className="edit-form-select" required>
              {budgetPlanStates.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <button className="button" type="submit" disabled={loading}>Speichern</button>
        </form>
      )}
      {message && <p className="edit-message">{message}</p>}
    </div>
  );
}
