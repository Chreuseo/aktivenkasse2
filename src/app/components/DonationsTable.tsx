'use client';

import React, { useMemo } from 'react';
import '@/app/css/tables.css';
import { DonationRow, DonationTypeUi } from '@/app/types/donation';
import { ClientTableHead } from '@/app/components/clientTable/ClientTableHead';
import { useClientTable, type ColumnDef } from '@/app/components/clientTable/useClientTable';

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
  const columns = useMemo<ColumnDef<DonationRow>[]>(() => {
    const cols: ColumnDef<DonationRow>[] = [];
    if (showUser) {
      cols.push({
        id: 'userName',
        header: 'Nutzer',
        type: 'text',
        accessor: (d) => d.userName ?? '',
        cell: (d) => d.userName || '-',
      });
    }

    cols.push(
      {
        id: 'date',
        header: 'Datum',
        type: 'date',
        accessor: (d) => d.date,
        cell: (d) => new Date(d.date).toLocaleDateString(),
      },
      {
        id: 'description',
        header: 'Beschreibung',
        type: 'text',
        accessor: (d) => d.description,
      },
      {
        id: 'type',
        header: 'Art',
        type: 'text',
        accessor: (d) => typeLabel(d.type),
        cell: (d) => typeLabel(d.type),
      },
      {
        id: 'amount',
        header: 'Betrag',
        type: 'number',
        accessor: (d) => Number(d.amount),
        cell: (d) => <span className="kc-fw-700">{Number(d.amount).toFixed(2)} €</span>,
      },
      {
        id: 'downloadedAt',
        header: 'Abgerufen',
        type: 'date',
        accessor: (d) => d.downloadedAt ?? '',
        cell: (d) => (d.downloadedAt ? new Date(d.downloadedAt).toLocaleDateString() : '-'),
      }
    );

    if (showProcessor) {
      cols.push({
        id: 'processorName',
        header: 'Ersteller',
        type: 'text',
        accessor: (d) => d.processorName ?? '',
        cell: (d) => d.processorName || '-',
      });
    }

    return cols;
  }, [showUser, showProcessor]);

  const table = useClientTable(donations, columns, { enableFilters: true });

  return (
    <table className="kc-table">
      <ClientTableHead table={table} />
      <tbody>
        {table.filteredSortedRows.length === 0 && (
          <tr>
            <td colSpan={table.columns.length} className="kc-cell--center kc-cell--muted">
              Keine Zuwendungsbescheide vorhanden
            </td>
          </tr>
        )}
        {table.filteredSortedRows.map((d) => (
          <tr key={d.id} className="kc-row">
            {table.columns.map((c) => (
              <td key={c.id}>{c.cell ? c.cell(d) : String(c.accessor(d) ?? '-') || '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
