"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, use } from "react";
import "../../../css/edit-form.css";

type User = {
    id: number;
    first_name: string;
    last_name: string;
    mail: string;
};

type Member = {
    id: number;
    name: string;
    mail: string;
};

export default function EditClearingAccountPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session } = useSession();
    const [formData, setFormData] = useState({
        name: "",
        responsibleId: "",
        reimbursementEligible: false,
    });
    const [users, setUsers] = useState<User[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [addMemberId, setAddMemberId] = useState("");

    // Daten laden
    useEffect(() => {
        async function loadData() {
            try {
                const token = session?.token || (session?.user && (session.user as any).token) || "";
                // Alle User
                const resUsers = await fetch("/api/users", {
                    method: "GET",
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        "Content-Type": "application/json",
                    },
                });
                const usersJson = await resUsers.json();
                if (resUsers.ok) setUsers(usersJson);
                // Kontodaten
                const resCa = await fetch(`/api/clearing-accounts/${id}`, {
                    method: "GET",
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        "Content-Type": "application/json",
                    },
                });
                const caJson = await resCa.json();
                if (resCa.ok) {
                    setFormData({
                        name: caJson.name,
                        responsibleId: caJson.responsibleId ? String(caJson.responsibleId) : "",
                        reimbursementEligible: !!caJson.reimbursementEligible,
                    });
                    setMembers(caJson.members);
                }
            } catch {}
        }
        loadData();
    }, [session, id]);

    // Mitglieder, die noch nicht zugewiesen sind
    const availableMembers = users.filter(u => !members.some(m => m.id === u.id));

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

    const handleAddMember = () => {
        if (!addMemberId) return;
        const user = users.find(u => String(u.id) === addMemberId);
        if (user) {
            setMembers([...members, { id: user.id, name: `${user.first_name} ${user.last_name}`, mail: user.mail }]);
            setAddMemberId("");
        }
    };

    const handleRemoveMember = (id: number) => {
        setMembers(members.filter(m => m.id !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);
        try {
            const token = session?.token || (session?.user && (session.user as any).token) || "";
            const res = await fetch(`/api/clearing-accounts/${id}/edit`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    name: formData.name,
                    responsibleId: formData.responsibleId || null,
                    reimbursementEligible: formData.reimbursementEligible,
                    memberIds: members.map(m => m.id),
                }),
            });
            if (res.ok) {
                setMessage("✅ Änderungen gespeichert!");
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
        <div className="edit-form-container">
            <h1>Verrechnungskonto bearbeiten</h1>
            <form onSubmit={handleSubmit} className="edit-form">
                <label>
                    Name
                    <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                </label>
                <label>
                    Verantwortlicher (optional)
                    <select name="responsibleId" value={formData.responsibleId} onChange={handleChange} className="edit-form-select">
                        <option value="">-- Kein Verantwortlicher --</option>
                        {users.map(u => (
                            <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.mail})</option>
                        ))}
                    </select>
                </label>
                <label>
                    Erstattungsberechtigt
                    <select name="reimbursementEligible" value={formData.reimbursementEligible ? "true" : "false"} onChange={e => setFormData({ ...formData, reimbursementEligible: e.target.value === "true" })} className="edit-form-select">
                        <option value="true">Ja</option>
                        <option value="false">Nein</option>
                    </select>
                </label>
                <div className="edit-members-section">
                    <div className="edit-members-list">
                        <span>Mitglieder:</span>
                        {members.length === 0 && <span className="edit-members-none">Keine Mitglieder</span>}
                        <ul>
                            {members.map(m => (
                                <li key={m.id} className="edit-member-item">
                                    {m.name} ({m.mail})
                                    <button type="button" className="edit-member-remove" onClick={() => handleRemoveMember(m.id)} title="Entfernen">✖</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="edit-member-add">
                        <select value={addMemberId} onChange={e => setAddMemberId(e.target.value)} className="edit-form-select">
                            <option value="">Mitglied hinzufügen...</option>
                            {availableMembers.map(u => (
                                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.mail})</option>
                            ))}
                        </select>
                        <button type="button" className="edit-member-add-btn" onClick={handleAddMember} disabled={!addMemberId}>Hinzufügen</button>
                    </div>
                </div>
                <button className="button" type="submit" disabled={loading}>Speichern</button>
            </form>
            {message && <p className="edit-message">{message}</p>}
        </div>
    );
}
