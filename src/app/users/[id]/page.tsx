import React from "react";

export default function UserDetailPage({ params }: { params: { id: string } }) {
  // TODO: Detailansicht für Nutzer mit ID {params.id} implementieren
  return (
    <div style={{ maxWidth: 700, margin: "2rem auto", padding: "1rem" }}>
      <h2>Nutzer-Detailansicht</h2>
      <p>Nutzer-ID: {params.id}</p>
      {/* Weitere Details folgen */}
    </div>
  );
}

