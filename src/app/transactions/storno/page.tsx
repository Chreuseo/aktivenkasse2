"use client";

import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import '../../css/forms.css';
import { extractToken, fetchJson } from '@/lib/utils';
import type { User } from '@/app/types/clearingAccount';
import type { BankAccount } from '@/app/types/bankAccount';
import type { ClearingAccount } from '@/app/types/clearingAccount';

type AccountType = 'user' | 'bank' | 'clearing_account';

type TxOption = {
  id: number;
  date: string;
  description: string;
  reference?: string;
  amount: number;
  hasCounter: boolean;
  processed: boolean;
  storno: boolean;
};

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: 'user', label: 'Nutzer' },
  { value: 'bank', label: 'Bankkonto' },
  { value: 'clearing_account', label: 'Verrechnungskonto' },
];

function formatDate(value: string) {
  try {
	return value.slice(0, 10);
  } catch {
	return value;
  }
}

function getAccountDisplayName(opt: any) {
  if (!opt) return '';
  if (opt.name) return opt.name;
  if (opt.first_name && opt.last_name) return `${opt.first_name} ${opt.last_name}`;
  if (opt.iban) return opt.iban;
  if (opt.mail) return opt.mail;
  return String(opt.id || 'Unbekannt');
}

function sortUsersAlpha(users: User[]): User[] {
  return [...users].sort((a, b) => {
	const al = `${a.last_name ?? ''}`.trim();
	const bl = `${b.last_name ?? ''}`.trim();
	const c1 = al.localeCompare(bl, 'de', { sensitivity: 'base' });
	if (c1 !== 0) return c1;
	const af = `${a.first_name ?? ''}`.trim();
	const bf = `${b.first_name ?? ''}`.trim();
	return af.localeCompare(bf, 'de', { sensitivity: 'base' });
  });
}

function sortByNameAlpha<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'de', { sensitivity: 'base', numeric: true }));
}

export default function TransactionStornoPage() {
  const { data: session } = useSession();
  const [accountType, setAccountType] = useState<AccountType>('user');
  const [accountEntityId, setAccountEntityId] = useState('');
  const [transactionId, setTransactionId] = useState('');

  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [bankOptions, setBankOptions] = useState<BankAccount[]>([]);
  const [clearingOptions, setClearingOptions] = useState<ClearingAccount[]>([]);
  const [transactions, setTransactions] = useState<TxOption[]>([]);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const token = extractToken(session);

  useEffect(() => {
	if (!token) return;
	setLoadingAccounts(true);
	const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

	Promise.all([
	  fetchJson('/api/users', { headers }).then((u) => setUserOptions(sortUsersAlpha(Array.isArray(u) ? u : []))),
	  fetchJson('/api/bank-accounts', { headers }).then((b) => setBankOptions(sortByNameAlpha(Array.isArray(b) ? b : []))),
	  fetchJson('/api/clearing-accounts', { headers }).then((c) => setClearingOptions(sortByNameAlpha(Array.isArray(c) ? c : []))),
	])
	  .catch(() => setMessage('❌ Konten konnten nicht geladen werden'))
	  .finally(() => setLoadingAccounts(false));
  }, [token]);

  useEffect(() => {
	setAccountEntityId('');
	setTransactionId('');
	setTransactions([]);
	setMessage('');
  }, [accountType]);

  useEffect(() => {
	if (!token || !accountEntityId) {
	  setTransactions([]);
	  setTransactionId('');
	  return;
	}

	setLoadingTransactions(true);
	setMessage('');
	const url = `/api/transactions/storno?accountType=${encodeURIComponent(accountType)}&accountEntityId=${encodeURIComponent(accountEntityId)}&limit=500`;

	fetchJson(url, { headers: { Authorization: `Bearer ${token}` } })
	  .then((list) => {
		const mapped = Array.isArray(list) ? list : [];
		setTransactions(mapped);
		setTransactionId('');
	  })
	  .catch((e: any) => {
		setTransactions([]);
		setTransactionId('');
		setMessage(`❌ ${e?.message || 'Transaktionen konnten nicht geladen werden'}`);
	  })
	  .finally(() => setLoadingTransactions(false));
  }, [token, accountType, accountEntityId]);

  const accountOptions = useMemo(() => {
	if (accountType === 'user') return userOptions;
	if (accountType === 'bank') return bankOptions;
	return clearingOptions;
  }, [accountType, userOptions, bankOptions, clearingOptions]);

  const canSubmit = !!token && !!accountEntityId && !!transactionId && !loadingTransactions && !submitting;

  async function onSubmit(e: React.FormEvent) {
	e.preventDefault();
	setMessage('');

	if (!transactionId) {
	  setMessage('❌ Bitte eine Transaktion auswählen');
	  return;
	}

	const txIdNum = Number(transactionId);
	if (!Number.isFinite(txIdNum) || txIdNum <= 0) {
	  setMessage('❌ Ungültige Transaktion');
	  return;
	}

	if (!window.confirm('Soll die ausgewählte Transaktion wirklich storniert werden? Eine vorhandene Gegentransaktion wird automatisch mit storniert.')) {
	  return;
	}

	setSubmitting(true);
	try {
	  const result = await fetchJson('/api/transactions/storno', {
		method: 'POST',
		headers: {
		  'Content-Type': 'application/json',
		  ...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ transactionId: txIdNum }),
	  });

	  const created = Array.isArray(result?.stornoTransactions) ? result.stornoTransactions.length : 0;
	  const reopened = Array.isArray(result?.reopenedAdvances) ? result.reopenedAdvances.length : 0;
	  setMessage(`✅ Storno durchgeführt. Erzeugte Stornobuchungen: ${created}. Wieder geöffnete Auslagen: ${reopened}.`);

	  const refreshed = await fetchJson(
		`/api/transactions/storno?accountType=${encodeURIComponent(accountType)}&accountEntityId=${encodeURIComponent(accountEntityId)}&limit=500`,
		{ headers: { Authorization: `Bearer ${token}` } }
	  );
	  setTransactions(Array.isArray(refreshed) ? refreshed : []);
	  setTransactionId('');
	} catch (e: any) {
	  setMessage(`❌ ${e?.message || 'Stornierung fehlgeschlagen'}`);
	} finally {
	  setSubmitting(false);
	}
  }

  return (
	<div className="form-container">
	  <h1>Transaktion stornieren</h1>
	  <form onSubmit={onSubmit} className="form">
		<label>
		  Kontotyp
		  <select
			value={accountType}
			onChange={(e) => setAccountType(e.target.value as AccountType)}
			className="form-select form-select-max"
			disabled={loadingAccounts || !token}
		  >
			{accountTypes.map((opt) => (
			  <option key={opt.value} value={opt.value}>{opt.label}</option>
			))}
		  </select>
		</label>

		<label>
		  Konto
		  <select
			value={accountEntityId}
			onChange={(e) => setAccountEntityId(e.target.value)}
			className="form-select form-select-max"
			required
			disabled={loadingAccounts || !token}
		  >
			<option value="">{loadingAccounts ? 'Lade...' : 'Bitte wählen'}</option>
			{accountOptions.map((opt: any) => (
			  <option key={opt.id} value={opt.id}>{getAccountDisplayName(opt)}</option>
			))}
		  </select>
		</label>

		<label>
		  Transaktion
		  <select
			value={transactionId}
			onChange={(e) => setTransactionId(e.target.value)}
			className="form-select form-select-max"
			required
			disabled={!accountEntityId || loadingTransactions || !token}
		  >
			<option value="">{loadingTransactions ? 'Lade...' : 'Bitte wählen'}</option>
			{transactions.map((t) => (
			  <option key={t.id} value={t.id}>
				{`${t.id} | ${formatDate(t.date)} | ${t.amount.toFixed(2)} EUR | ${t.description}${t.hasCounter ? ' | mit Gegentransaktion' : ''}${t.processed ? '' : ' | zukünftig'}`}
			  </option>
			))}
		  </select>
		</label>

		<p className="kc-hint u-mt-0">
		  Hinweis: Eine vorhandene Gegentransaktion wird immer automatisch mit storniert.
		</p>

		<button type="submit" disabled={!canSubmit}>{submitting ? 'Storniere...' : 'Stornieren'}</button>
	  </form>

	  {message && <p className="message kc-preline">{message}</p>}
	</div>
  );
}

