"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import { extractToken } from "@/lib/utils";
import "../../css/forms.css";
import AttachmentHint from "@/app/components/AttachmentHint";

type Props = {
  accounts: { id: number; name: string }[];
};

export default function NewAdvanceForm({ accounts }: Props) {
  const { data: session } = useSession();
  const [dateAdvance, setDateAdvance] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [clearingAccountId, setClearingAccountId] = useState<string>("");
  const [isDonation, setIsDonation] = useState<boolean>(false);
  const [donationType, setDonationType] = useState<'material' | 'waive_fees'>('material');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const amt = parseFloat(amount.replace(",", "."));
    if (!dateAdvance || !description) {
      setMessage("Bitte Auslagedatum und Beschreibung ausfüllen.");
      return;
    }
    if (!amount || isNaN(amt) || amt <= 0) {
      setMessage("Betrag ist Pflicht, muss > 0 sein.");
      return;
    }
    try {
      setLoading(true);
      const fd = new FormData();
      fd.append("date_advance", dateAdvance);
      fd.append("description", description);
      fd.append("amount", amt.toString());
      if (clearingAccountId) fd.append("clearingAccountId", clearingAccountId);
      fd.append("is_donation", isDonation ? 'true' : 'false');
      if (isDonation) fd.append('donationType', donationType);
      if (file) fd.append("beleg", file);

      const token = extractToken(session);
      const res = await fetch("/api/advances", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Unbekannter Fehler");

      setMessage(`✅ Auslage angelegt (ID ${json.id}).`);
      // Reset
      setDescription("");
      setDateAdvance(new Date().toISOString().slice(0, 10));
      setAmount("");
      setClearingAccountId("");
      setIsDonation(false);
      setDonationType('material');
      setFile(null);
      const fileInput = document.getElementById("beleg-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch (e: any) {
      setMessage(`❌ Fehler: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h1>Neue Auslage anlegen</h1>
      <form className="form" onSubmit={onSubmit}>
        <label>
          Auslagedatum
          <input
            type="date"
            name="date_advance"
            value={dateAdvance}
            onChange={(e) => setDateAdvance(e.target.value)}
            required
          />
        </label>

        <label>
          Beschreibung
          <input
            type="text"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="Kurzbeschreibung der Auslage"
          />
        </label>

        <label>
          Betrag
          <input
            type="number"
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            min="0.01"
            step="0.01"
            placeholder="0,00"
          />
        </label>

        <label>
          Verrechnungskonto (optional)
          <select
            className="form-select form-select-max"
            name="clearingAccountId"
            value={clearingAccountId}
            onChange={(e) => setClearingAccountId(e.target.value)}
          >
            <option value="">— Kein Verrechnungskonto —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Beleg (Datei)
          <input
            id="beleg-input"
            className="form-file-upload"
            type="file"
            name="beleg"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            accept="image/*,application/pdf"
          />
        </label>
        <AttachmentHint file={file} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={isDonation}
            onChange={(e) => setIsDonation(e.target.checked)}
          />
          Spende
        </label>

        {isDonation && (
          <label>
            Art
            <select
              className="form-select form-select-max"
              value={donationType}
              onChange={(e) => setDonationType(e.target.value as any)}
            >
              <option value="material">Sachspende</option>
              <option value="waive_fees">Verzichtsspende</option>
            </select>
          </label>
        )}

        <button type="submit" disabled={loading || !session}>
          {loading ? "Wird gespeichert…" : "Auslage anlegen"}
        </button>
      </form>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
