'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import '@/app/css/tables.css';
import { DonationCreateCandidate } from '@/app/types/donation';

export default function DonationCreateTable({
  rows,
  selected,
  onToggleSelectedAction,
  onToggleAllAction,
  descriptions,
  onChangeDescriptionAction,
}: {
  rows: DonationCreateCandidate[];
  selected: Set<number>; // transactionId
  onToggleSelectedAction: (transactionId: number) => void;
  onToggleAllAction: (nextChecked: boolean) => void;
  descriptions: Record<number, string>;
  onChangeDescriptionAction: (transactionId: number, value: string) => void;
}) {
  const allIds = useMemo(() => rows.map((r) => r.transactionId), [rows]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));

  const headerCbRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCbRef.current) {
      headerCbRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <table className="kc-table">
      <thead>
        <tr>
          <th style={{ width: 60 }}>
            <input
              ref={headerCbRef}
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleAllAction(e.target.checked)}
              aria-label="Alle auswählen"
            />
          </th>
          <th>Benutzer</th>
          <th>Datum</th>
          <th>Beschreibung</th>
          <th>Betrag</th>
          <th>Kontostand</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>
              Keine passenden Transaktionen gefunden
            </td>
          </tr>
        )}

        {rows.map((r) => {
          const isSelected = selected.has(r.transactionId);
          const balColor = r.balance < 0 ? '#e11d48' : '#059669';
          return (
            <tr key={r.transactionId} className="kc-row">
              <td>
                <input type="checkbox" checked={isSelected} onChange={() => onToggleSelectedAction(r.transactionId)} />
              </td>
              <td>{r.userName}</td>
              <td>{new Date(r.date).toLocaleDateString()}</td>
              <td>
                <input
                  className="kc-input"
                  style={{ width: '100%' }}
                  type="text"
                  value={descriptions[r.transactionId] ?? r.description}
                  onChange={(e) => onChangeDescriptionAction(r.transactionId, e.target.value)}
                />
              </td>
              <td style={{ fontWeight: 600 }}>{r.amount.toFixed(2)} €</td>
              <td style={{ color: balColor, fontWeight: 700 }}>{r.balance.toFixed(2)} €</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
