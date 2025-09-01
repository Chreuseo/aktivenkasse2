"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { BudgetPlan } from "../utils";

export default function NewBudgetPlanPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        description: ""
    });
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            const token = extractToken(session);
            await fetchJson("/api/budget-plan", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(formData),
            });
            setMessage("✅ Haushaltsplan erfolgreich angelegt!");
            setFormData({ name: "", description: "" });
        } catch (error: any) {
            setMessage("❌ " + (error?.message || "Serverfehler"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <h1>Neuen Haushaltsplan anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
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

                <button className="button" type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
