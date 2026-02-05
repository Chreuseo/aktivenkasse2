// Zentrale Service-Funktionen zur Erstellung von Transaktionen (einzeln, paarweise, Bulk)
// Vereinheitlicht die Updates von Kontoständen und Links (Gegenbuchung, Bulk-Verknüpfungen).

// Typen bewusst locker (any), um Transaktionsclient (Prisma tx) kompatibel zu nutzen
// ohne harte Abhängigkeit auf Prisma-Typen in allen Call-Sites.

type PrismaTx = any;

export type CreateTransactionParams = {
  accountId: number;
  amount: number; // signierter Betrag
  description: string;
  createdById: number;
  reference?: string | null;
  dateValued?: Date | null;
  attachmentId?: number | null;
  costCenterId?: number | null;
  extraData?: Record<string, any>; // optionale zusätzliche Felder (z.B. transactionBulk)
};

export type BulkTransactionType = 'collection' | 'deposit' | 'payout';

function getEnvMulti(keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim().length) return String(v);
  }
  return fallback;
}

function getDefaultDueDays(): number {
  const str = getEnvMulti(["DUE_DEFAULT_DAYS", "DUES_DEFAULT_DAYS", "due.default.days"], "14");
  const n = parseInt(str, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

function computeDueDateFrom(paymentDate: Date): Date {
  const days = getDefaultDueDays();
  return new Date(paymentDate.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function settleDuesForAccountOnDeposit(p: PrismaTx, params: { accountId: number; paymentAmount: number; paymentDate: Date }) {
  const { accountId, paymentAmount, paymentDate } = params;
  let remaining = Number(paymentAmount);
  if (!(remaining > 0)) return { paidDueIds: [] as number[], newDueId: null as number | null, remainingPayment: remaining };

  // Offene Fälligkeiten nach Fälligkeit/ID sortiert (FIFO)
  const dues: Array<{ id: number; amount: any; dueDate: Date }> = await p.dues.findMany({
    where: { accountId, paid: false },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, dueDate: true },
  });

  const paidIds: number[] = [];
  let newDueId: number | null = null;

  for (const d of dues) {
    if (!(remaining > 0)) break;
    const dueAmount = Number(d.amount);

    if (remaining >= dueAmount - 1e-6) {
      // Vollständig beglichen
      await p.dues.update({ where: { id: d.id }, data: { paid: true, paidAt: paymentDate } });
      paidIds.push(d.id);
      remaining = Math.max(0, remaining - dueAmount);
    } else {
      // Teilzahlung: alte Fälligkeit schließen und neue Fälligkeit für Rest ab Zahldatum erzeugen
      const rest = Math.max(0, dueAmount - remaining);
      await p.dues.update({ where: { id: d.id }, data: { paid: true, paidAt: paymentDate } });
      paidIds.push(d.id);
      const newDue = await p.dues.create({
        data: {
          accountId,
          amount: Number(rest),
          dueDate: computeDueDateFrom(paymentDate),
          // createdAt = now() automatisch, paid=false default
        },
      });
      newDueId = newDue.id;
      remaining = 0;
      break;
    }
  }

  return { paidDueIds: paidIds, newDueId, remainingPayment: remaining };
}

export async function createTransactionWithBalance(p: PrismaTx, params: CreateTransactionParams) {
  const {
    accountId,
    amount,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId,
    extraData,
  } = params;

  const acc = await p.account.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account nicht gefunden');
  const bal = Number(acc.balance);

  // Bewertungsdatum bestimmen und prüfen, ob es in der Zukunft liegt
  const valuedDate: Date | undefined = dateValued ?? undefined;
  const isFuture = !!valuedDate && valuedDate.getTime() > Date.now();

  // Wenn in der Zukunft: nicht buchen (processed=false), Kontostand unverändert
  // Sonst: buchen (processed=true)
  const willProcess = !isFuture;
  const newBal = willProcess ? bal + Number(amount) : bal;

  const tx = await p.transaction.create({
    data: {
      amount: Number(amount),
      ...(valuedDate ? { date_valued: valuedDate } : {}),
      description: String(description),
      ...(reference ? { reference: String(reference) } : {}),
      account: { connect: { id: accountId } },
      accountValueAfter: newBal,
      processed: willProcess,
      ...(attachmentId ? { attachment: { connect: { id: Number(attachmentId) } } } : {}),
      ...(costCenterId ? { costCenter: { connect: { id: Number(costCenterId) } } } : {}),
      createdBy: { connect: { id: createdById } },
      ...(extraData || {}),
    },
  });

  if (willProcess) {
    await p.account.update({ where: { id: accountId }, data: { balance: newBal } });

    // Neue Fälligkeitslogik: Einzahlungen gleichen offene Fälligkeiten aus
    if (Number(amount) > 0) {
      const paymentDate: Date = valuedDate ?? new Date();
      await settleDuesForAccountOnDeposit(p, { accountId, paymentAmount: Number(amount), paymentDate });
    }
  }

  return tx;
}

export type CreatePairedParams = {
  account1Id: number;
  amount1: number; // signiert
  account2Id: number;
  amount2: number; // signiert
  description: string;
  createdById: number;
  reference?: string | null;
  dateValued?: Date | null;
  attachmentId?: number | null;
  costCenterId1?: number | null;
  costCenterId2?: number | null;
};

export async function createPairedTransactions(p: PrismaTx, params: CreatePairedParams) {
  const {
    account1Id,
    amount1,
    account2Id,
    amount2,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId1,
    costCenterId2,
  } = params;

  const tx1 = await createTransactionWithBalance(p, {
    accountId: account1Id,
    amount: amount1,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId: costCenterId1 ?? null,
  });

  const tx2 = await createTransactionWithBalance(p, {
    accountId: account2Id,
    amount: amount2,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId: costCenterId2 ?? null,
  });

  await p.transaction.update({ where: { id: tx1.id }, data: { counter_transaction: { connect: { id: tx2.id } } } });
  await p.transaction.update({ where: { id: tx2.id }, data: { counter_transaction: { connect: { id: tx1.id } } } });

  return { tx1, tx2 };
}

export type CreateBulkMainParams = {
  mainAccountId: number;
  mainAmount: number; // Summe (signiert) fürs Hauptkonto
  description: string;
  createdById: number;
  type: BulkTransactionType;
  dateValued: Date;
  reference?: string | null;
  attachmentId?: number | null;
};

export async function createBulkWithMain(p: PrismaTx, params: CreateBulkMainParams) {
  const { mainAccountId, mainAmount, description, createdById, type, dateValued, reference, attachmentId } = params;
  const mainTx = await createTransactionWithBalance(p, {
    accountId: mainAccountId,
    amount: mainAmount,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
  });

  const bulk = await p.transactionBulk.create({
    data: {
      date_valued: dateValued,
      description,
      reference: reference ?? undefined,
      account: { connect: { id: mainAccountId } },
      ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
      mainTransaction: { connect: { id: mainTx.id } },
      type,
    },
  });

  // Rücklink auch am mainTx setzen, damit Daten konsistent sind
  await p.transaction.update({ where: { id: mainTx.id }, data: { transactionBulk: { connect: { id: bulk.id } } } });

  return { bulk, mainTx };
}

export type AddBulkRowWithCounterParams = {
  bulkId: number;
  mainTxId: number;
  rowAccountId: number;
  amount: number; // signiert, Gegenbuchung zu mainTx
  description: string;
  createdById: number;
  dateValued: Date;
  reference?: string | null;
  attachmentId?: number | null;
  costCenterId?: number | null;
};

export async function addBulkRowWithCounter(p: PrismaTx, params: AddBulkRowWithCounterParams) {
  const { bulkId, mainTxId, rowAccountId, amount, description, createdById, dateValued, reference, attachmentId, costCenterId } = params;

  return await createTransactionWithBalance(p, {
    accountId: rowAccountId,
    amount,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId: costCenterId ?? null,
    extraData: { transactionBulk: { connect: { id: bulkId } }, counter_transaction: { connect: { id: mainTxId } } },
  });
}

export type AddBulkMainCostCenterRowParams = {
  bulkId: number;
  mainAccountId: number;
  amount: number; // signiert; weitere Buchung auf Hauptkonto
  description: string;
  createdById: number;
  dateValued: Date;
  reference?: string | null;
  attachmentId?: number | null;
  costCenterId: number; // Pflicht für diese Variante
};

export async function addBulkMainCostCenterRow(p: PrismaTx, params: AddBulkMainCostCenterRowParams) {
  const { bulkId, mainAccountId, amount, description, createdById, dateValued, reference, attachmentId, costCenterId } = params;

  return await createTransactionWithBalance(p, {
    accountId: mainAccountId,
    amount,
    description,
    createdById,
    reference,
    dateValued,
    attachmentId,
    costCenterId,
    extraData: { transactionBulk: { connect: { id: bulkId } } },
  });
}

export type CreateMultipleTransactionsParams = {
  rows: Array<{
    accountId: number;
    amount: number; // signiert
    description: string;
    createdById: number;
    dateValued: Date;
    reference?: string | null;
    attachmentId?: number | null;
    costCenterId?: number | null;
  }>;
};

export async function createMultipleTransactions(p: PrismaTx, params: CreateMultipleTransactionsParams) {
  const created: any[] = [];
  for (const r of params.rows) {
    const tx = await createTransactionWithBalance(p, r);
    created.push(tx);
  }
  return created;
}

export async function processPendingTransactions(p: PrismaTx) {
  // Verarbeite alle Transaktionen, die noch nicht gebucht sind und deren Bewertungsdatum erreicht ist
  const now = new Date();
  const pending = await p.transaction.findMany({
    where: { processed: false, date_valued: { lte: now } },
    select: { id: true, amount: true, accountId: true, date_valued: true },
    orderBy: [{ date_valued: 'asc' }, { id: 'asc' }],
  });

  const processedIds: number[] = [];

  for (const tx of pending) {
    const acc = await p.account.findUnique({ where: { id: tx.accountId }, select: { id: true, balance: true } });
    if (!acc) continue;

    const newBal = Number(acc.balance) + Number(tx.amount);

    // Transaktion als verarbeitet markieren und accountValueAfter setzen
    await p.transaction.update({
      where: { id: tx.id },
      data: { processed: true, accountValueAfter: newBal },
    });

    // Kontostand aktualisieren
    await p.account.update({ where: { id: acc.id }, data: { balance: newBal } });

    // Einzahlungen gleichen Fälligkeiten aus (analog zu createTransactionWithBalance)
    if (Number(tx.amount) > 0) {
      const paymentDate: Date = tx.date_valued ?? now;
      await settleDuesForAccountOnDeposit(p, { accountId: acc.id, paymentAmount: Number(tx.amount), paymentDate });
    }

    processedIds.push(tx.id);
  }

  return { count: processedIds.length, ids: processedIds };
}
