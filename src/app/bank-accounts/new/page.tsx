"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/app/lib/utils";

// Utility für Token-Extraktion
// function extractToken(session: any): string {
//     return (session?.token as string)
//         || (session?.user && typeof session.user === 'object' && (session.user as any).token)
//         || "";
// }

export default function NewBankAccountPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        bank: "",
        iban: "",
        bic: ""
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
            await fetchJson("/api/bank-accounts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(formData),
            });
            setMessage("✅ Bankkonto erfolgreich angelegt!");
            setFormData({ name: "", bank: "", iban: "", bic: "" });
        } catch (error: any) {
            setMessage("❌ " + (error?.message || "Serverfehler"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <h1>Neues Bankkonto anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
                <label>
                    Name
                    <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                </label>

                <label>
                    Bank
                    <input type="text" name="bank" value={formData.bank} onChange={handleChange} required />
                </label>

                <label>
                    IBAN
                    <input type="text" name="iban" value={formData.iban} onChange={handleChange} required />
                </label>

                <label>
                    BIC (optional)
                    <input type="text" name="bic" value={formData.bic} onChange={handleChange} />
                </label>

                <button className="button" type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
