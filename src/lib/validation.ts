// Zentrale Validierungs- und Normalisierungsfunktionen für API-Handler

export type AccountTypeStr = 'user' | 'bank' | 'clearing_account';
export type BulkTypeStr = 'einzug' | 'einzahlung' | 'auszahlung';

export function normalizeBoolean(val: any, defaultValue = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const v = val.toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === '') return false;
  }
  return defaultValue;
}

// Leitet das Vorzeichen für das Gegenkonto gemäß der Frontend-Logik ab
export function computeAccount2Negative(account1Type: AccountTypeStr, account2Type: AccountTypeStr | '', account1Negative: boolean): boolean {
  if (!account2Type) return false;
  if (account1Type === account2Type) return !account1Negative;
  const isBankVsOther =
    (account1Type === 'bank' && (account2Type === 'user' || account2Type === 'clearing_account')) ||
    (account2Type === 'bank' && (account1Type === 'user' || account1Type === 'clearing_account'));
  if (isBankVsOther) return account1Negative;
  const isUserClearing =
    (account1Type === 'user' && account2Type === 'clearing_account') ||
    (account1Type === 'clearing_account' && account2Type === 'user');
  if (isUserClearing) return !account1Negative;
  // Fallback: symmetrisch
  return !account1Negative;
}

export function isAllowedMainAccountForBulk(bulkType: BulkTypeStr, accountType: AccountTypeStr): boolean {
  if (bulkType === 'einzahlung') return accountType === 'bank';
  if (bulkType === 'einzug' || bulkType === 'auszahlung') return accountType === 'user' || accountType === 'clearing_account';
  return false;
}

export function isAllowedRowTypeForBulk(rowType: string): rowType is Exclude<AccountTypeStr, 'bank'> {
  return rowType === 'user' || rowType === 'clearing_account';
}

export function isAllowedAttachment(mime?: string | null): boolean {
  if (!mime) return true; // konservativ erlauben, wenn unbekannt
  return mime.startsWith('image/') || mime === 'application/pdf';
}

export function parsePositiveAmount(val: any): number | null {
  const n = Number(val);
  if (!isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs <= 0) return null;
  return abs;
}

