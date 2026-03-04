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
          <th className="kc-col--w-60">
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
            <td colSpan={6} className="kc-cell--center kc-cell--muted">
              Keine passenden Transaktionen gefunden
            </td>
          </tr>
        )}

        {rows.map((r) => {
          const isSelected = selected.has(r.transactionId);
          const balIsNeg = r.balance < 0;
          return (
            <tr key={r.transactionId} className="kc-row">
              <td>
                <input type="checkbox" checked={isSelected} onChange={() => onToggleSelectedAction(r.transactionId)} />
              </td>
              <td>{r.userName}</td>
              <td>{new Date(r.date).toLocaleDateString()}</td>
              <td>
                <input
                  className="kc-input kc-input--full"
                  type="text"
                  value={descriptions[r.transactionId] ?? r.description}
                  onChange={(e) => onChangeDescriptionAction(r.transactionId, e.target.value)}
                />
              </td>
              <td className="kc-fw-600">{r.amount.toFixed(2)} €</td>
              <td className={balIsNeg ? "kc-amount-neg kc-fw-700" : "kc-amount-pos kc-fw-700"}>{r.balance.toFixed(2)} €</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
