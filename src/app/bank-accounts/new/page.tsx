"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import "../../css/edit-form.css";
import { extractToken, fetchJson } from "@/lib/utils";

export default function NewBankAccountPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        owner: "",
        bank: "",
        iban: "",
        bic: "",
        payment_method: false,
        create_girocode: false,
    });
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, type, value, checked } = e.target;
        setFormData({ ...formData, [name]: type === "checkbox" ? checked : value });
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
                body: JSON.stringify({
                    name: formData.name,
                    owner: formData.owner,
                    bank: formData.bank,
                    iban: formData.iban,
                    bic: formData.bic,
                    payment_method: formData.payment_method,
                    create_girocode: formData.create_girocode,
                }),
            });
            setMessage("✅ Bankkonto erfolgreich angelegt!");
            setFormData({ name: "", owner: "", bank: "", iban: "", bic: "", payment_method: false, create_girocode: false });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setMessage("❌ " + (msg || "Serverfehler"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="edit-form-container">
            <h1>Neues Bankkonto anlegen</h1>
            <form onSubmit={handleSubmit} className="edit-form">
                <label>
                    Name
                    <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                </label>

                <label>
                    Kontoinhaber
                    <input type="text" name="owner" value={formData.owner} onChange={handleChange} required />
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

                <label>
                    In Zahlungsaufforderung anzeigen{" "}
                    <input type="checkbox" name="payment_method" checked={formData.payment_method} onChange={handleChange} />
                </label>

                <label>
                    GiroCode in Mail/Beleg erzeugen
                    <input type="checkbox" name="create_girocode" checked={formData.create_girocode} onChange={handleChange} />
                </label>

                <button className="button" type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="edit-message">{message}</p>}
        </div>
    );
}
