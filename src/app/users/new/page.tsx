"use client";

import { useState } from "react";
import "../../css/forms.css";

export default function NewUserPage() {
    const [formData, setFormData] = useState({
        first_name: "",
        last_name: "",
        mail: "",
    });

    const [message, setMessage] = useState("");

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");

        try {
            const res = await fetch("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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

                <button type="submit">Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
