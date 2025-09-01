"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";

// Dummy-Daten für die Auswahl (später per API ersetzen)
const accountTypes = [
    { value: "user", label: "Nutzer" },
    { value: "bank", label: "Bankkonto" },
    { value: "clearing_account", label: "Verrechnungskonto" },
];

export default function NewTransactionPage() {
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        amount: "",
        sign: "+",
        date_valued: "",
        description: "",
        reference: "",
        account1Type: "user",
        account1Id: "",
        account2Type: "", // Typ2 vorausgefüllt leer
        account2Id: "",
        attachment: null as File | null,
        signAccounts: ["+", "+"],
    });
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    // Auswahl-Daten aus der API
    const [userOptions, setUserOptions] = useState<User[]>([]);
    const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
    const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);

    // Budgetplan und Kostenstellen
    const [budgetPlans, setBudgetPlans] = useState<any[]>([]);
    const [costCenters, setCostCenters] = useState<any[]>([]);
    const [budgetPlanId, setBudgetPlanId] = useState<string>("");
    const [costCenterId, setCostCenterId] = useState<string>("");

    // Daten beim ersten Rendern laden
    useEffect(() => {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        fetchJson("/api/users", { headers }).then(setUserOptions).catch(() => setUserOptions([]));
        fetchJson("/api/bank-accounts", { headers }).then(setBankOptions).catch(() => setBankOptions([]));
        fetchJson("/api/clearing-accounts", { headers }).then(setClearingOptions).catch(() => setClearingOptions([]));
        fetchJson("/api/budget-plan", { headers })
            .then(setBudgetPlans)
            .catch(() => setBudgetPlans([]));
    }, [session]);

    // Kostenstellen laden, wenn Budgetplan gewählt
    useEffect(() => {
        if (!budgetPlanId) {
            setCostCenters([]);
            setCostCenterId("");
            return;
        }
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        fetchJson(`/api/budget-plan/cost-centers?planId=${budgetPlanId}`, { headers })
            .then(setCostCenters)
            .catch(() => setCostCenters([]));
    }, [budgetPlanId, session]);

    // Hilfsfunktionen für die Auswahl
    const getOptions = (type: string) => {
        if (type === "user") return userOptions;
        if (type === "bank") return bankOptions;
        if (type === "clearing_account") return clearingOptions;
        return [];
    };

    // Hilfsfunktion für die Anzeige des Namens
    function getAccountDisplayName(opt: any) {
        if (!opt) return "";
        if (opt.name) return opt.name;
        if (opt.first_name && opt.last_name) return `${opt.first_name} ${opt.last_name}`;
        if (opt.iban) return opt.iban;
        if (opt.mail) return opt.mail;
        return String(opt.id || "Unbekannt");
    }

    // Neuer State für die Vorzeichen
    const [account1Negative, setAccount1Negative] = useState(false);
    const [account2Negative, setAccount2Negative] = useState(false);

    // Synchronisiere die Vorzeichen-Logik bei Typ-Änderung
    useEffect(() => {
        // Wenn Typ2 leer, ist account2Negative immer false
        if (!formData.account2Type) {
            setAccount2Negative(false);
            return;
        }
        // Logik für die Vorzeichen
        if (formData.account1Type === formData.account2Type) {
            // Beide Typen gleich: wechselseitig negiert
            setAccount2Negative(!account1Negative);
        } else if (
            (formData.account1Type === "bank" && (formData.account2Type === "user" || formData.account2Type === "clearing_account")) ||
            (formData.account2Type === "bank" && (formData.account1Type === "user" || formData.account1Type === "clearing_account"))
        ) {
            // Einer Bank, einer Nutzer/Verrechnungskonto: beide gleich
            setAccount2Negative(account1Negative);
        } else if (
            (formData.account1Type === "user" && formData.account2Type === "clearing_account") ||
            (formData.account1Type === "clearing_account" && formData.account2Type === "user")
        ) {
            // Nutzer und Verrechnungskonto: wechselseitig negiert
            setAccount2Negative(!account1Negative);
        }
    }, [formData.account1Type, formData.account2Type, account1Negative]);

    // Handler für oberen Button
    const handleTopButton = () => {
        if (!formData.account2Type) {
            setAccount1Negative((prev) => !prev);
        }
    };
    // Handler für unteren Buttons
    const handleBottomButton = () => {
        // Wenn Typ2 leer, nur account1Negative toggeln
        if (!formData.account2Type) {
            setAccount1Negative((prev) => !prev);
            return;
        }
        // Wenn Typ2 befüllt, beide synchron toggeln
        setAccount1Negative((prev) => !prev);
        // account2Negative wird automatisch durch useEffect synchronisiert
    };

    // Handler
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };
    // Die unteren Buttons sollen keine Funktionalität haben
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, attachment: e.target.files?.[0] || null });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            const token = extractToken(session);
            const formDataObj = new FormData();
            formDataObj.append("amount", Math.abs(Number(formData.amount)).toString());
            formDataObj.append("date_valued", formData.date_valued);
            formDataObj.append("description", formData.description);
            formDataObj.append("reference", formData.reference);
            formDataObj.append("account1Type", formData.account1Type);
            formDataObj.append("account1Id", formData.account1Id);
            formDataObj.append("account2Type", formData.account2Type);
            formDataObj.append("account2Id", formData.account2Id);
            // Vorzeichen-Logik je nach Buchungsart
            if (!formData.account2Type) {
                // Einzelbuchung: Nur account1Negative aus dem oberen Button
                formDataObj.append("account1Negative", account1Negative ? "true" : "false");
            } else {
                // Doppelbuchung: Beide Vorzeichen aus den States
                formDataObj.append("account1Negative", account1Negative ? "true" : "false");
                formDataObj.append("account2Negative", account2Negative ? "true" : "false");
            }
            if (budgetPlanId) formDataObj.append("budgetPlanId", budgetPlanId);
            if (costCenterId) formDataObj.append("costCenterId", costCenterId);
            if (formData.attachment) {
                formDataObj.append("attachment", formData.attachment);
            }
            const res = await fetch("/api/transactions", {
                method: "POST",
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: formDataObj,
            });
            let result;
            try {
                result = await res.json();
            } catch {
                result = {};
            }
            if (!res.ok) {
                let msg = "❌ Fehler beim Speichern.";
                if (result?.error) msg += `\n${result.error}`;
                if (result?.detail) msg += `\n${result.detail}`;
                if (result?.fields) msg += `\nFehlende Felder: ${Object.keys(result.fields).filter(k => !result.fields[k]).join(", ")}`;
                setMessage(msg);
            } else {
                setMessage("✅ Transaktion erfolgreich angelegt!");
                setFormData({
                    amount: "",
                    sign: "+",
                    date_valued: "",
                    description: "",
                    reference: "",
                    account1Type: "user", // Default
                    account1Id: "",
                    account2Type: "", // Default leer
                    account2Id: "",
                    attachment: null,
                    signAccounts: ["+", "+"],
                });
            }
        } catch (error: any) {
            setMessage("❌ " + (error?.message || "Serverfehler"));
        } finally {
            setLoading(false);
        }
    };

    // Initialisiere Wertstellung mit heutigem Datum
    useEffect(() => {
        if (!formData.date_valued) {
            const today = new Date().toISOString().slice(0, 10);
            setFormData(prev => ({ ...prev, date_valued: today }));
        }
    }, []);

    return (
        <div className="form-container">
            <h1>Neue Transaktion anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
                <label>
                    Wertstellung (optional)
                    <input
                        type="date"
                        name="date_valued"
                        value={formData.date_valued}
                        onChange={handleChange}
                        // nicht required
                    />
                </label>
                <div className="form-accounts-row">
                    <div className="form-account-col">
                        <label>
                            Typ
                            <select
                                name="account1Type"
                                className="form-select form-select-max"
                                value={formData.account1Type}
                                onChange={handleChange}
                                style={{ maxWidth: "220px" }}
                            >
                                {accountTypes.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Auswahl
                            <select
                                name="account1Id"
                                className="form-select form-select-max"
                                value={formData.account1Id}
                                onChange={handleChange}
                                required
                                style={{ maxWidth: "220px" }}
                            >
                                <option value="">Bitte wählen</option>
                                {getOptions(formData.account1Type).map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                        {getAccountDisplayName(opt)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="form-sign-toggle"
                            onClick={handleBottomButton}
                            disabled={false}
                        >
                            {account1Negative ? "-" : "+"}
                        </button>
                    </div>
                    <div className="form-account-col">
                        <label>
                            Typ
                            <select
                                name="account2Type"
                                className="form-select form-select-max"
                                value={formData.account2Type}
                                onChange={e => {
                                    const value = e.target.value;
                                    setFormData({
                                        ...formData,
                                        account2Type: value,
                                        account2Id: "", // Immer zurücksetzen, wenn Typ geändert wird
                                    });
                                }}
                                style={{ maxWidth: "220px" }}
                            >
                                <option value="">---</option>
                                {accountTypes.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Auswahl
                            <select
                                name="account2Id"
                                className="form-select form-select-max"
                                value={formData.account2Id}
                                onChange={handleChange}
                                required={!!formData.account2Type}
                                disabled={formData.account2Type === ""}
                                style={{ maxWidth: "220px" }}
                            >
                                <option value="">---</option>
                                {getOptions(formData.account2Type).map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                        {getAccountDisplayName(opt)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="form-sign-toggle"
                            onClick={handleBottomButton}
                            disabled={!formData.account2Type}
                        >
                            {account2Negative ? "-" : "+"}
                        </button>
                    </div>
                </div>
                <label>
                    Beschreibung
                    <input
                        type="text"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        required
                    />
                </label>
                <label>
                    Referenz (optional)
                    <input
                        type="text"
                        name="reference"
                        value={formData.reference}
                        onChange={handleChange}
                        // nicht required
                    />
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    {/* Oberer Button nur anzeigen, wenn Typ2 leer ist */}
                    {!formData.account2Type && (
                        <button
                            type="button"
                            className="form-sign-toggle"
                            onClick={handleTopButton}
                        >
                            {account1Negative ? "-" : "+"}
                        </button>
                    )}
                    <label style={{ flex: 1 }}>
                        Betrag
                        <input
                            type="number"
                            name="amount"
                            value={formData.amount}
                            onChange={handleChange}
                            required
                            min="0"
                        />
                    </label>
                </div>
                <label>
                    Budgetplan (optional)
                    <select
                        name="budgetPlanId"
                        className="form-select form-select-max"
                        value={budgetPlanId}
                        onChange={e => setBudgetPlanId(e.target.value)}
                        style={{ maxWidth: "220px" }}
                    >
                        <option value="">Kein Budgetplan</option>
                        {budgetPlans.map(bp => (
                            <option key={bp.id} value={bp.id}>{bp.name}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Kostenstelle
                    <select
                        name="costCenterId"
                        className="form-select form-select-max"
                        value={costCenterId}
                        onChange={e => setCostCenterId(e.target.value)}
                        disabled={!budgetPlanId}
                        style={{ maxWidth: "220px" }}
                    >
                        <option value="">Bitte wählen</option>
                        {costCenters.map(cc => (
                            <option key={cc.id} value={cc.id}>{cc.name}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Anhang
                    <input
                        type="file"
                        className="form-file-upload"
                        onChange={handleFileChange}
                        accept="image/*,application/pdf"
                    />
                </label>
                <button type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
