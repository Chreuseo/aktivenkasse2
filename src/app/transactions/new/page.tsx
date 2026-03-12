"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import "../../css/forms.css";
import { extractToken, fetchJson } from "@/lib/utils";
import type { User } from "@/app/types/clearingAccount";
import type { BankAccount } from "@/app/types/bankAccount";
import type { ClearingAccount } from "@/app/types/clearingAccount";
import AttachmentHint from "@/app/components/AttachmentHint";

const accountTypes = [
    { value: "user", label: "Nutzer" },
    { value: "bank", label: "Bankkonto" },
    { value: "clearing_account", label: "Verrechnungskonto" },
];

function getOptions(type: string, userOptions: User[], bankOptions: BankAccount[], clearingOptions: ClearingAccount[]) {
    if (type === "user") return userOptions;
    if (type === "bank") return bankOptions;
    if (type === "clearing_account") return clearingOptions;
    return [];
}

function getAccountDisplayName(opt: any) {
    if (!opt) return "";
    if (opt.name) return opt.name;
    if (opt.first_name && opt.last_name) return `${opt.first_name} ${opt.last_name}`;
    if (opt.iban) return opt.iban;
    if (opt.mail) return opt.mail;
    return String(opt.id || "Unbekannt");
}

function sortUsersAlpha(users: User[]): User[] {
    return [...users].sort((a, b) => {
        const al = `${a.last_name ?? ''}`.trim();
        const bl = `${b.last_name ?? ''}`.trim();
        const c1 = al.localeCompare(bl, 'de', { sensitivity: 'base' });
        if (c1 !== 0) return c1;
        const af = `${a.first_name ?? ''}`.trim();
        const bf = `${b.first_name ?? ''}`.trim();
        return af.localeCompare(bf, 'de', { sensitivity: 'base' });
    });
}

function sortByNameAlpha<T extends { name?: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'de', { sensitivity: 'base', numeric: true }));
}

function sortCostCentersAlpha(items: any[]): any[] {
    return [...items].sort((a, b) => {
        const al = String(a?.label ?? a?.name ?? '').trim();
        const bl = String(b?.label ?? b?.name ?? '').trim();
        return al.localeCompare(bl, 'de', { sensitivity: 'base', numeric: true });
    });
}

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
        account2Type: "",
        account2Id: "",
        attachment: null as File | null,
        signAccounts: ["+", "+"],
    });
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [userOptions, setUserOptions] = useState<User[]>([]);
    const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
    const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);
    const [budgetPlans, setBudgetPlans] = useState<any[]>([]);
    const [costCenters, setCostCenters] = useState<any[]>([]);
    const [budgetPlanId, setBudgetPlanId] = useState<string>("");
    const [costCenterId, setCostCenterId] = useState<string>("");
    const [account1Negative, setAccount1Negative] = useState(false);
    const [account2Negative, setAccount2Negative] = useState(false);
    const [isDonation, setIsDonation] = useState(false);

    const amountNum = Number(formData.amount);
    const amountPositive = Number.isFinite(amountNum) && amountNum > 0;
    const hasUserAndBank =
        !!formData.account2Type &&
        ((formData.account1Type === 'user' && formData.account2Type === 'bank') ||
            (formData.account1Type === 'bank' && formData.account2Type === 'user'));
    const signsArePlus = !account1Negative && !account2Negative;
    const canDonate = hasUserAndBank && amountPositive && signsArePlus;

    useEffect(() => {
        // Falls Bedingungen nicht mehr erfüllt sind, Spendenmodus deaktivieren
        if (!canDonate && isDonation) setIsDonation(false);
    }, [canDonate, isDonation]);

    // Daten laden
    useEffect(() => {
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        fetchJson("/api/users", { headers }).then((u) => setUserOptions(sortUsersAlpha(u))).catch(() => setUserOptions([]));
        fetchJson("/api/bank-accounts", { headers }).then((b) => setBankOptions(sortByNameAlpha(b))).catch(() => setBankOptions([]));
        fetchJson("/api/clearing-accounts", { headers }).then((c) => setClearingOptions(sortByNameAlpha(c))).catch(() => setClearingOptions([]));
        fetchJson("/api/budget-plan", { headers })
            .then((list) => {
                const active = Array.isArray(list) ? list.filter((p: any) => p?.state === 'active') : [];
                setBudgetPlans(sortByNameAlpha(active));
            })
            .catch(() => setBudgetPlans([]));
    }, [session]);

    useEffect(() => {
        if (!budgetPlanId) {
            setCostCenters([]);
            setCostCenterId("");
            return;
        }
        const token = extractToken(session);
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        fetchJson(`/api/budget-plan/cost-centers?planId=${budgetPlanId}`, { headers })
            .then((list) => setCostCenters(sortCostCentersAlpha(Array.isArray(list) ? list : [])))
            .catch(() => setCostCenters([]));
    }, [budgetPlanId, session]);

    // Initialisiere Wertstellung mit heutigem Datum
    useEffect(() => {
        if (!formData.date_valued) {
            const today = new Date().toISOString().slice(0, 10);
            setFormData(prev => ({ ...prev, date_valued: today }));
        }
    }, [formData.date_valued]);

    // Vorzeichen-Logik
    useEffect(() => {
        if (!formData.account2Type) {
            setAccount2Negative(false);
            return;
        }
        if (formData.account1Type === formData.account2Type) {
            setAccount2Negative(!account1Negative);
        } else if (
            (formData.account1Type === "bank" && (formData.account2Type === "user" || formData.account2Type === "clearing_account")) ||
            (formData.account2Type === "bank" && (formData.account1Type === "user" || formData.account1Type === "clearing_account"))
        ) {
            setAccount2Negative(account1Negative);
        } else if (
            (formData.account1Type === "user" && formData.account2Type === "clearing_account") ||
            (formData.account1Type === "clearing_account" && formData.account2Type === "user")
        ) {
            setAccount2Negative(!account1Negative);
        }
    }, [formData.account1Type, formData.account2Type, account1Negative]);

    // Wenn Gegenkonto gewählt ist, Budgetplan/Kostenstelle zurücksetzen
    useEffect(() => {
        // Wenn Gegenkonto gewählt ist, Budgetplan/Kostenstelle zurücksetzen
        if (formData.account2Type) {
            setBudgetPlanId("");
            setCostCenterId("");
        }
    }, [formData.account2Type]);

    // Handler
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, attachment: e.target.files?.[0] || null }));
    }, []);

    const handleAccount2TypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        setFormData(prev => ({ ...prev, account2Type: value, account2Id: "" }));
    }, []);

    const handleTopButton = useCallback(() => {
        if (!formData.account2Type) {
            setAccount1Negative(prev => !prev);
        }
    }, [formData.account2Type]);

    const handleBottomButton = useCallback(() => {
        setAccount1Negative(prev => !prev);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            // Client-Validierung
            if (isDonation) {
                if (!budgetPlanId || !costCenterId) {
                    setMessage("❌ Budgetplan und Kostenstelle sind Pflicht für Spenden");
                    setLoading(false);
                    return;
                }
            } else {
                // Ohne Gegenkonto sind Budgetplan & Kostenstelle Pflicht
                if (!formData.account2Type) {
                    if (!budgetPlanId || !costCenterId) {
                        setMessage("❌ Kostenstelle ist Pflicht ohne Gegenkonto (Budgetplan und Kostenstelle angeben)");
                        setLoading(false);
                        return;
                    }
                }
            }

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
            formDataObj.append("account1Negative", account1Negative ? "true" : "false");
            if (formData.account2Type) {
                formDataObj.append("account2Negative", account2Negative ? "true" : "false");
            }
            if (budgetPlanId) formDataObj.append("budgetPlanId", budgetPlanId);
            if (costCenterId) formDataObj.append("costCenterId", costCenterId);
            if (formData.attachment) {
                formDataObj.append("attachment", formData.attachment);
            }
            if (isDonation) {
                formDataObj.append('isDonation', 'true');
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
                    date_valued: new Date().toISOString().slice(0, 10),
                    description: "",
                    reference: "",
                    account1Type: "user",
                    account1Id: "",
                    account2Type: "",
                    account2Id: "",
                    attachment: null,
                    signAccounts: ["+", "+"],
                });
                setAccount1Negative(false);
                setAccount2Negative(false);
                setIsDonation(false);
                setBudgetPlanId("");
                setCostCenterId("");
            }
        } catch (error: any) {
            setMessage("❌ " + (error?.message || "Serverfehler"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <h1>Neue Transaktion anlegen</h1>
            <form onSubmit={handleSubmit} className="form">
                <label>
                    Datum (optional)
                    <input
                        type="date"
                        name="date_valued"
                        value={formData.date_valued}
                        onChange={handleChange}
                    />
                </label>
                <div className="form-accounts-row">
                    <div className="form-account-col">
                        <label>
                            Typ
                            <select
                                name="account1Type"
                                className="form-select form-select-max kc-max-220"
                                value={formData.account1Type}
                                onChange={handleChange}
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
                                className="form-select form-select-max kc-max-220"
                                value={formData.account1Id}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Bitte wählen</option>
                                {getOptions(formData.account1Type, userOptions, bankOptions, clearingOptions).map((opt) => (
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
                                className="form-select form-select-max kc-max-220"
                                value={formData.account2Type}
                                onChange={handleAccount2TypeChange}
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
                                className="form-select form-select-max kc-max-220"
                                value={formData.account2Id}
                                onChange={handleChange}
                                required={!!formData.account2Type}
                                disabled={formData.account2Type === ""}
                            >
                                <option value="">---</option>
                                {getOptions(formData.account2Type, userOptions, bankOptions, clearingOptions).map((opt) => (
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
                    />
                </label>
                <div className="kc-inline-controls">
                    {!formData.account2Type && (
                        <button
                            type="button"
                            className="form-sign-toggle"
                            onClick={handleTopButton}
                        >
                            {account1Negative ? "-" : "+"}
                        </button>
                    )}
                    <label className="kc-flex-1">
                        Betrag
                        <input
                            type="number"
                            name="amount"
                            value={formData.amount}
                            onChange={handleChange}
                            required
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                        />
                    </label>
                </div>
                <label>
                    Budgetplan {formData.account2Type && !isDonation ? "(optional)" : "(Pflicht)"}
                    <select
                        name="budgetPlanId"
                        className="form-select form-select-max kc-max-220"
                        value={budgetPlanId}
                        onChange={e => setBudgetPlanId(e.target.value)}
                        disabled={!!formData.account2Type && !isDonation}
                        required={!formData.account2Type || isDonation}
                    >
                        <option value="">Kein Budgetplan</option>
                        {budgetPlans.map(bp => (
                            <option key={bp.id} value={bp.id}>{bp.name}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Kostenstelle {formData.account2Type && !isDonation ? "(optional)" : "(Pflicht)"}
                    <select
                        name="costCenterId"
                        className="form-select form-select-max kc-max-220"
                        value={costCenterId}
                        onChange={e => setCostCenterId(e.target.value)}
                        disabled={!budgetPlanId}
                        required={!formData.account2Type || isDonation}
                    >
                        <option value="">Bitte wählen</option>
                        {costCenters.map(cc => (
                            <option key={cc.id} value={cc.id}>{cc.name}</option>
                        ))}
                    </select>
                </label>
                <label className="kc-checkline">
                    <input
                        type="checkbox"
                        checked={isDonation}
                        onChange={(e) => setIsDonation(e.target.checked)}
                        disabled={!canDonate}
                    />
                    Spende
                </label>
                {!canDonate && (
                    <p className="hint u-mt-0">
                        (Spende ist verfügbar bei Nutzer + Bankkonto, positivem Betrag und wenn beide Vorzeichen auf + stehen)
                    </p>
                )}
                <label>
                    Anhang
                    <input
                        type="file"
                        className="form-file-upload"
                        onChange={handleFileChange}
                        accept="image/*,application/pdf"
                    />
                </label>
                <AttachmentHint file={formData.attachment} />
                <button type="submit" disabled={loading}>Anlegen</button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}
