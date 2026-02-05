import prisma from '@/lib/prisma';
import { processPendingTransactions } from '@/services/transactionService';

export async function runCronProcessPending() {
  // Führt die Verarbeitung innerhalb einer Prisma-Transaktion aus
  return await prisma.$transaction(async (p) => {
    const res = await processPendingTransactions(p);
    return res;
  });
}
