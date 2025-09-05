"use client";

import { useSession } from "next-auth/react";
import "../css/forms.css";

type Props = { accountUrl?: string };

export default function AccountClient({ accountUrl }: Props) {
  const { data: session } = useSession();
  const user: any = session?.user || {};
  const name = user?.name || "";
  const email = user?.email || "";

  return (
    <div className="form-container">
      <h1>Mein Konto</h1>
      {session ? (
        <div className="form">
          <label>
            Name{" "}
            <span
              style={{
                marginLeft: "0.5rem",
                fontWeight: 500,
                fontSize: "0.75rem",
                color: "#9ca3af",
                border: "1px dashed #3a3a3f",
                borderRadius: 4,
                padding: "0 0.35rem",
              }}
            >
              schreibgeschützt
            </span>
            <input
              type="text"
              value={name}
              readOnly
              disabled
              title="Nicht editierbar – wird in Keycloak verwaltet"
            />
          </label>

          <label>
            E-Mail{" "}
            <span
              style={{
                marginLeft: "0.5rem",
                fontWeight: 500,
                fontSize: "0.75rem",
                color: "#9ca3af",
                border: "1px dashed #3a3a3f",
                borderRadius: 4,
                padding: "0 0.35rem",
              }}
            >
              schreibgeschützt
            </span>
            <input
              type="email"
              value={email}
              readOnly
              disabled
              title="Nicht editierbar – wird in Keycloak verwaltet"
            />
          </label>

          <p style={{ margin: 0 }}>
            Persönliche Daten (z. B. Name, E‑Mail) und Zugangsdaten werden in
            Keycloak verwaltet. Änderungen bitte direkt dort vornehmen.
          </p>

          {accountUrl ? (
            <button
              type="button"
              onClick={() => window.open(accountUrl, "_blank", "noopener")}
            >
              In Keycloak ändern
            </button>
          ) : (
            <div className="message">Keycloak-Link nicht konfiguriert.</div>
          )}
        </div>
      ) : (
        <p className="message">Nicht angemeldet.</p>
      )}
    </div>
  );
}
