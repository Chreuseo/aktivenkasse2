// Zentrale Service-Funktionen zur Erstellung von Transaktionen (einzeln, paarweise, Bulk)
// Vereinheitlicht die Updates von Kontoständen und Links (Gegenbuchung, Bulk-Verknüpfungen).

import { BulkTransactionType } from '@prisma/client';

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
  const newBal = bal + Number(amount);

  const tx = await p.transaction.create({
    data: {
      amount: Number(amount),
      ...(dateValued ? { date_valued: dateValued } : {}),
      description: String(description),
      ...(reference ? { reference: String(reference) } : {}),
      account: { connect: { id: accountId } },
      accountValueAfter: newBal,
      ...(attachmentId ? { attachment: { connect: { id: Number(attachmentId) } } } : {}),
      ...(costCenterId ? { costCenter: { connect: { id: Number(costCenterId) } } } : {}),
      createdBy: { connect: { id: createdById } },
      ...(extraData || {}),
    },
  });
  await p.account.update({ where: { id: accountId }, data: { balance: newBal } });
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

  const txRow = await createTransactionWithBalance(p, {
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

  return txRow;
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

  const tx = await createTransactionWithBalance(p, {
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

  return tx;
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
