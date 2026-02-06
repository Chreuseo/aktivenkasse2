'use client';

import React from 'react';
import '@/app/css/tables.css';
import { DonationRow, DonationTypeUi } from '@/app/types/donation';

function typeLabel(t: DonationTypeUi) {
  switch (t) {
    case 'financial':
      return 'Geldspende';
    case 'material':
      return 'Sachspende';
    case 'waiver':
      return 'Verzichtsspende';
    default:
      return t;
  }
}

export default function DonationsTable({
  donations,
  showUser,
  showProcessor,
}: {
  donations: DonationRow[];
  showUser: boolean;
  showProcessor: boolean;
}) {
  const colSpan = (showUser ? 1 : 0) + 1 + 1 + 1 + 1 + (showProcessor ? 1 : 0);

  return (
    <table className="kc-table">
      <thead>
        <tr>
          {showUser && <th>Nutzer</th>}
          <th>Datum</th>
          <th>Beschreibung</th>
          <th>Art</th>
          <th>Betrag</th>
          {showProcessor && <th>Ersteller</th>}
        </tr>
      </thead>
      <tbody>
        {donations.length === 0 && (
          <tr>
            <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--muted)' }}>
              Keine Zuwendungsbescheide vorhanden
            </td>
          </tr>
        )}
        {donations.map((d) => (
          <tr key={d.id} className="kc-row">
            {showUser && <td>{d.userName || '-'}</td>}
            <td>{new Date(d.date).toLocaleDateString()}</td>
            <td>{d.description}</td>
            <td>{typeLabel(d.type)}</td>
            <td style={{ fontWeight: 700 }}>{Number(d.amount).toFixed(2)} €</td>
            {showProcessor && <td>{d.processorName || '-'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
