"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import "../../css/forms.css";

// Utility für Token-Extraktion
function extractToken(session: any): string {
    return (session?.token as string)
        || (session?.user && typeof session.user === 'object' && (session.user as any).token)
        || "";
}

export default function NewUserPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        first_name: "",
        last_name: "",
        mail: "",
    });
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            const token = extractToken(session);
            const res = await fetch("/api/users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(formData),
            });
            if (res.ok) {
                setMessage("✅ User erfolgreich angelegt!");
                setFormData({ first_name: "", last_name: "", mail: ""});
            } else {
                const err = await res.json();
                setMessage("❌ Fehler: " + err.error);
            }
        } catch (error) {
            setMessage("❌ Serverfehler");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <h1>Neuen Nutzer anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
                <label>
                    Vorname
                    <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} required />
                </label>

                <label>
                    Nachname
                    <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} required />
                </label>

                <label>
                    E-Mail
                    <input type="email" name="mail" value={formData.mail} onChange={handleChange} required />
                </label>

                <button className="button" type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
