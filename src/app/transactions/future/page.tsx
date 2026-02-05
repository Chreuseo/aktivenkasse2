'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Transaction } from '@/app/types/transaction';
import '@/app/css/tables.css';

// Hilfstypen für Filterauswahl
type UserOpt = { id: number; label: string };
type BankOpt = { id: number; label: string };
type CaOpt = { id: number; label: string };

type FilterType = '' | 'user' | 'bank' | 'clearing';

export default function FutureTransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  // Filterzustände: erst Typ, dann Entität
  const [filterType, setFilterType] = useState<FilterType>('');
  const [selectedId, setSelectedId] = useState<number | ''>('');

  // Optionen aus Overview-APIs
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [banks, setBanks] = useState<BankOpt[]>([]);
  const [cas, setCas] = useState<CaOpt[]>([]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (filterType === 'user' && selectedId) sp.set('userId', String(selectedId));
    if (filterType === 'bank' && selectedId) sp.set('bankAccountId', String(selectedId));
    if (filterType === 'clearing' && selectedId) sp.set('clearingAccountId', String(selectedId));
    return sp.toString();
  }, [filterType, selectedId]);

  async function loadOptions() {
    try {
      const [usersRes, banksRes, casRes] = await Promise.all([
        fetch('/api/users?limit=1000'),
        fetch('/api/bank-accounts?limit=1000'),
        fetch('/api/clearing-accounts?limit=1000'),
      ]);
      const [usersJson, banksJson, casJson] = await Promise.all([
        usersRes.json(),
        banksRes.json(),
        casRes.json(),
      ]);
      const userOpts: UserOpt[] = Array.isArray(usersJson)
        ? usersJson.map((u: any) => ({ id: u.id, label: `${u.first_name} ${u.last_name}` }))
        : [];
      const bankOpts: BankOpt[] = Array.isArray(banksJson)
        ? banksJson.map((b: any) => ({ id: b.id, label: `${b.name} (${b.bank})` }))
        : [];
      const caOpts: CaOpt[] = Array.isArray(casJson)
        ? casJson.map((c: any) => ({ id: c.id, label: c.name }))
        : [];
      setUsers(userOpts);
      setBanks(bankOpts);
      setCas(caOpts);
    } catch (e) {
      // still ok
    }
  }

  async function loadData() {
    setLoading(true);
    setMessage('');
    try {
      const url = '/api/transactions/future' + (queryString ? `?${queryString}` : '');
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(err?.error || `Fehler: ${res.status}`);
        setTransactions([]);
      } else {
        const data: Transaction[] = await res.json();
        setTransactions(data);
      }
    } catch (e: any) {
      setMessage(String(e?.message || e));
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadOptions(); }, []);
  useEffect(() => { loadData(); }, [queryString]);

  async function handleDelete(id: number) {
    if (!confirm('Wirklich löschen? Ungebuchte Transaktion und ggf. Gegenbuchung werden entfernt.')) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/transactions/future?id=${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json?.error || `Fehler: ${res.status}`);
      } else {
        setMessage('✅ Transaktion gelöscht');
        await loadData();
      }
    } catch (e: any) {
      setMessage(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Hilfsfunktion: verfügbare Optionen abhängig vom Typ
  const currentOptions = useMemo(() => {
    if (filterType === 'user') return users;
    if (filterType === 'bank') return banks;
    if (filterType === 'clearing') return cas;
    return [] as Array<{ id: number; label: string }>;
  }, [filterType, users, banks, cas]);

  return (
    <div className="kc-page">
      <h2>Zukünftige Transaktionen</h2>
      <div className="kc-toolbar" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <label>
          Filtertyp
          <select
            value={filterType}
            onChange={(e) => {
              const val = e.target.value as FilterType;
              setFilterType(val);
              // Beim Wechsel des Typs die Auswahl zurücksetzen
              setSelectedId('');
            }}
          >
            <option value="">Alle</option>
            <option value="user">Nutzer</option>
            <option value="bank">Bankkonto</option>
            <option value="clearing">Verrechnungskonto</option>
          </select>
        </label>

        <label>
          {filterType === '' ? '—' : filterType === 'user' ? 'Nutzer' : filterType === 'bank' ? 'Bankkonto' : 'Verrechnungskonto'}
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
            disabled={filterType === ''}
          >
            <option value="">Alle</option>
            {currentOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      {message && <p className="message">{message}</p>}
      {loading && <p className="message">Laden…</p>}

      <table className="kc-table">
        <thead>
          <tr>
            <th>Hauptkonto</th>
            <th>Betrag</th>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th>Referenz</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>Keine zukünftigen Transaktionen</td></tr>
          )}
          {transactions.map(tx => (
            // Keine Grau-Hinterlegung hier: alle sind zukünftige Transaktionen
            <tr key={tx.id}>
              <td>{tx.main ? (
                <span>
                  {tx.main.type === 'user' && `Nutzer: ${tx.main.name}`}
                  {tx.main.type === 'bank' && `Bankkonto: ${tx.main.name}`}
                  {tx.main.type === 'clearing_account' && `Verrechnungskonto: ${tx.main.name}`}
                </span>
              ) : <span style={{ color: 'var(--muted)' }}>-</span>}
              </td>
              <td style={{ color: tx.amount < 0 ? '#e11d48' : '#059669', fontWeight: 600 }}>{tx.amount.toFixed(2)} €</td>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description}</td>
              <td>{tx.reference || '-'}</td>
              <td>
                <button className="button" onClick={() => handleDelete(tx.id)}>Löschen</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
