"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { extractToken, fetchJson } from "@/lib/utils";
import { User } from "@/app/types/clearingAccount";
import "../../css/forms.css";

export default function NewClearingAccountPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        responsibleId: "",
        reimbursementEligible: false,
    });
    const [users, setUsers] = useState<User[]>([]);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        async function loadUsers() {
            try {
                const token = extractToken(session);
                const json = await fetchJson("/api/users", {
                    method: "GET",
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        "Content-Type": "application/json",
                    },
                });
                setUsers(json);
            } catch (err: any) {
                setMessage("❌ Fehler beim Laden der Nutzer: " + err.message);
            }
        }
        loadUsers();
    }, [session]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
            setFormData({
                ...formData,
                [name]: e.target.checked,
            });
        } else {
            setFormData({
                ...formData,
                [name]: value,
            });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            const token = extractToken(session);
            await fetchJson("/api/clearing-accounts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    name: formData.name,
                    responsibleId: formData.responsibleId || null,
                    reimbursementEligible: formData.reimbursementEligible,
                }),
            });
            setMessage("✅ Verrechnungskonto erfolgreich angelegt!");
            setFormData({ name: "", responsibleId: "", reimbursementEligible: false });
        } catch (error: any) {
            setMessage("❌ Fehler: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <h1>Neues Verrechnungskonto anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
                <label>
                    Name
                    <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                </label>
                <label>
                    Verantwortlicher (optional)
                    <select name="responsibleId" value={formData.responsibleId} onChange={handleChange} className="form-select">
                        <option value="">-- Kein Verantwortlicher --</option>
                        {users.map(u => (
                            <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.mail})</option>
                        ))}
                    </select>
                </label>
                <label>
                    Erstattungsberechtigt
                    <select name="reimbursementEligible" value={formData.reimbursementEligible ? "true" : "false"} onChange={e => setFormData({ ...formData, reimbursementEligible: e.target.value === "true" })} className="form-select">
                        <option value="true">Ja</option>
                        <option value="false">Nein</option>
                    </select>
                </label>
                <button className="button" type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
