"use client";
import { useSession } from "next-auth/react";
import "../css/infobox.css";

export default function AccountPage() {
  const { data: session } = useSession();

  // Die wichtigsten User-Daten extrahieren
  const user = session?.user || {};
  const name = user.name || "-";
  const email = user.email || "-";
  const userId = user.id || session?.id || "-";

  // Hilfsfunktion: Key-Value-Paare rekursiv rendern, aber bestimmte Keys ausfiltern
  const excludeKeys = [];
  function renderData(data: Record<string, any>, parentKey = "") {
    if (!data || typeof data !== "object") return null;
    return Object.entries(data).map(([key, value]) => {
      const displayKey = parentKey ? `${parentKey}.${key}` : key;
      if (typeof value === "object" && value !== null) {
        return (
          <div key={displayKey} style={{marginBottom: "0.3rem", marginLeft: "1rem"}}>
            <strong>{displayKey}:</strong>
            <div style={{marginLeft: "1rem"}}>{renderData(value, displayKey)}</div>
          </div>
        );
      }
      // Token-Felder optisch kürzen, aber im title anzeigen
      if (key.toLowerCase().includes("token") && typeof value === "string") {
        return (
          <div key={displayKey} style={{marginBottom: "0.3rem"}}>
            <strong>{displayKey}:</strong> <span title={value}>{value.length > 20 ? value.slice(0, 16) + "..." : value}</span>
          </div>
        );
      }
      return (
        <div key={displayKey} style={{marginBottom: "0.3rem"}}>
          <strong>{displayKey}:</strong> {String(value)}
        </div>
      );
    });
  }

  return (
    <div>
      <div className="kc-infobox">
        <h2 style={{marginTop:0, marginBottom:"1rem"}}>Alle Session/JWT-Daten</h2>
        {session ? (
          <div>{renderData(session)}</div>
        ) : (
          <div style={{color: "#888"}}>Keine Session-Daten vorhanden.</div>
        )}
      </div>
      {/* ...weitere User-Übersicht... */}
    </div>
  );
}
