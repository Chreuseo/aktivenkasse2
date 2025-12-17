"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, use } from "react";
import { extractToken, fetchJson } from "@/lib/utils";
import { BankAccount } from "@/app/types/bankAccount";
import "../../../css/edit-form.css";

export default function EditBankAccountPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const numId = Number(id);
    const { data: session, status } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        owner: "",
        bank: "",
        iban: "",
        bic: "",
        balance: 0,
        payment_method: false,
        create_girocode: false,
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
                const accJson: BankAccount = await fetchJson(`/api/bank-accounts/${numId}` , {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                });
                setFormData({
                    name: accJson.name || "",
                    owner: accJson.owner || "",
                    bank: accJson.bank || "",
                    iban: accJson.iban || "",
                    bic: accJson.bic || "",
                    balance: accJson.balance,
                    payment_method: Boolean((accJson as any).payment_method),
                    create_girocode: Boolean((accJson as any).create_girocode),
                });
                setFormLoading(false);
            } catch (err: any) {
                setMessage("❌ Fehler beim Laden: " + err.message);
            }
        }
        loadData();
    }, [session, status, numId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, type, value, checked } = e.target;
        setFormData({ ...formData, [name]: type === "checkbox" ? checked : value });
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
            await fetchJson(`/api/bank-accounts/${numId}/edit`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
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
            setMessage("✅ Änderungen gespeichert!");
        } catch (error: any) {
            setMessage("❌ Fehler: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    if (status === "loading") return <div className="edit-form-container">Lade Session ...</div>;
    if (status === "unauthenticated") return <div className="edit-form-container">Bitte einloggen.</div>;
    if (formLoading) return <div className="edit-form-container">Lade Daten ...</div>;

    return (
        <div className="edit-form-container">
            <h1>Bankkonto bearbeiten</h1>
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
                <label>
                    Kontostand
                    <input type="text" name="balance" value={formData.balance.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} disabled />
                </label>
                <button className="button" type="submit" disabled={loading}>Speichern</button>
            </form>
            {message && <p className="edit-message">{message}</p>}
        </div>
    );
}
