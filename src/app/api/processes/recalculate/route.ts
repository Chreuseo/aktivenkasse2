import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkPermission } from '@/services/authService';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';

function asOptionalId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

// Use cents integer math to avoid floating problems with Decimal -> Number conversions.
function toCents(val: unknown): number {
  // Prisma Decimal comes through as string/Decimal; Number() is OK for 2 decimal values, but we round to cents.
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) throw new Error('Ungültiger Decimal-Wert');
  return Math.round(n * 100);
}

type EffectiveAccount = { id: number; label: string };

type AccountError = { accountId: number; soll: string; ist: string };

type TimelineEvent =
  | { kind: 'tx'; date: Date; id: number; amountCents: number; oldAfterCents: number }
  | { kind: 'allowance'; date: Date; id: number; amountCents: number };

export async function POST(req: Request) {
  // Permission: write_all on transactions (process can update transaction.accountValueAfter)
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body' }, { status: 400 });
  }

  const userId = asOptionalId(body?.userId);
  const clearingAccountId = asOptionalId(body?.clearingAccountId);
  const bankAccountId = asOptionalId(body?.bankAccountId);

  // Accounts bestimmen
  const accounts: EffectiveAccount[] = [];

  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, first_name: true, last_name: true, accountId: true } });
    if (!u) return NextResponse.json({ error: `Nutzer nicht gefunden (id ${userId})` }, { status: 404 });
    accounts.push({ id: u.accountId, label: `Nutzer ${u.first_name} ${u.last_name}` });
  }
  if (clearingAccountId) {
    const ca = await prisma.clearingAccount.findUnique({ where: { id: clearingAccountId }, select: { id: true, name: true, accountId: true } });
    if (!ca) return NextResponse.json({ error: `Verrechnungskonto nicht gefunden (id ${clearingAccountId})` }, { status: 404 });
    accounts.push({ id: ca.accountId, label: `Verrechnungskonto ${ca.name}` });
  }
  if (bankAccountId) {
    const ba = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, name: true, bank: true, accountId: true } });
    if (!ba) return NextResponse.json({ error: `Bankkonto nicht gefunden (id ${bankAccountId})` }, { status: 404 });
    accounts.push({ id: ba.accountId, label: `Bankkonto ${ba.name}${ba.bank ? ` (${ba.bank})` : ''}` });
  }

  let accountIds: number[];
  if (accounts.length === 0) {
    const all = await prisma.account.findMany({ select: { id: true } });
    accountIds = all.map((a) => a.id);
  } else {
    accountIds = Array.from(new Set(accounts.map((a) => a.id)));
  }

  try {
    const result = await prisma.$transaction(async (p) => {
      // Phase 1: Für alle Konten neu berechnen und Fehler sammeln.
      // Phase 2: Nur wenn fehlerfrei, Updates schreiben.

      const errors: AccountError[] = [];
      const updatesByAccount: Array<{ accountId: number; updates: Array<{ id: number; newAfterCents: number }> }> = [];

      for (const accountId of accountIds) {
        const acc = await p.account.findUnique({ where: { id: accountId }, select: { id: true, balance: true } });
        if (!acc) continue;

        // Nur verarbeitete Transaktionen: Kontostand spiegelt nur processed=true wider (siehe createTransactionWithBalance/processPendingTransactions)
        const txs = await p.transaction.findMany({
          where: { accountId, processed: true },
          select: { id: true, amount: true, accountValueAfter: true, date_valued: true },
          orderBy: [{ date_valued: 'asc' }, { id: 'asc' }],
        });

        // Alle Rückstellungen (auch geschlossene) als Timeline-Events einbauen:
        // - bei allowance.date: Betrag wird vom Konto abgezogen
        // - bei allowance.returnDate: Betrag wird wieder gutgeschrieben
        const allowances = await p.allowance.findMany({
          where: { accountId },
          select: { id: true, date: true, returnDate: true, amount: true },
        });

        const events: TimelineEvent[] = [];
        for (const t of txs) {
          events.push({
            kind: 'tx',
            date: t.date_valued,
            id: t.id,
            amountCents: toCents(t.amount),
            oldAfterCents: toCents(t.accountValueAfter),
          });
        }
        for (const a of allowances) {
          const amtCents = toCents(a.amount);
          // Abzug bei Anlage
          events.push({ kind: 'allowance', date: a.date, id: a.id, amountCents: -amtCents });
          // Gutschrift bei Rückgabe
          if (a.returnDate) {
            events.push({ kind: 'allowance', date: a.returnDate, id: a.id, amountCents: amtCents });
          }
        }

        // Sortierung: erst nach Datum, dann deterministisch nach kind/id
        // Wichtig: bei gleichem Timestamp sollen Allowance-Events vor/zwischen Transaktionen stabil bleiben.
        events.sort((a, b) => {
          const d = a.date.getTime() - b.date.getTime();
          if (d !== 0) return d;
          const ak = a.kind === 'allowance' ? 0 : 1;
          const bk = b.kind === 'allowance' ? 0 : 1;
          if (ak !== bk) return ak - bk;
          return a.id - b.id;
        });

        let runningCents = 0;
        const updates: Array<{ id: number; newAfterCents: number }> = [];

        for (const ev of events) {
          runningCents += ev.amountCents;
          if (ev.kind === 'tx') {
            const newAfterCents = runningCents;
            if (newAfterCents !== ev.oldAfterCents) {
              updates.push({ id: ev.id, newAfterCents });
            }
          }
        }

        const balanceCents = toCents(acc.balance);
        if (runningCents !== balanceCents) {
          // Soll = nachgerechnet; Ist = aktueller Kontostand
          errors.push({
            accountId,
            soll: (runningCents / 100).toFixed(2),
            ist: (balanceCents / 100).toFixed(2),
          });
          continue;
        }

        updatesByAccount.push({ accountId, updates });
      }

      if (errors.length > 0) {
        return { success: false, errors };
      }

      // Updates schreiben (fehlerfrei)
      let accountsAffected = 0;
      let transactionsAffected = 0;

      for (const entry of updatesByAccount) {
        const updates = entry.updates;
        if (updates.length === 0) continue;

        for (const u of updates) {
          await p.transaction.update({
            where: { id: u.id },
            data: { accountValueAfter: u.newAfterCents / 100 },
          });
        }

        accountsAffected += 1;
        transactionsAffected += updates.length;
      }

      return { success: true, accountsAffected, transactionsAffected };
    });

    if (result && typeof result === 'object' && 'success' in result && (result as any).success === false) {
      const errors = (result as any).errors as AccountError[];
      const headline = `Fehler in der Nachrechenaufgabe (${errors.length} Konto/Konten)`;
      const detail = errors
        .map((e) => `Fehler in der Nachrechenaufgabe bei Konto ${e.accountId}: Kontostand Soll: ${e.soll}; Kontostand Ist: ${e.ist}`)
        .join('\n');
      return NextResponse.json({ error: headline, detail, errors }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : 'Fehler';
    // eslint-disable-next-line no-console
    console.error('Recalculate process failed', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
