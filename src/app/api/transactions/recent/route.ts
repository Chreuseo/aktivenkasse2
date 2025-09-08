import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import type { Transaction } from "@/app/types/transaction";
import { checkPermission } from "@/services/authService";

function inferOtherFromAccount(acc: any): Transaction["other"] {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return { type: "user", name: `${u.first_name} ${u.last_name}`, mail: u.mail };
  }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return { type: "bank", name: b.name, bank: b.bank, iban: b.iban };
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return { type: "clearing_account", name: c.name };
  }
  return null;
}

export async function GET(req: NextRequest) {
  // Zentrale Berechtigungsprüfung
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) {
    const status = perm.error === "Kein Token" || perm.error === "Keine UserId im Token" ? 401 : 403;
    return NextResponse.json({ error: perm.error || "Forbidden" }, { status });
  }

  const txsRaw = await prisma.transaction.findMany({
    orderBy: { date: "desc" },
    take: 20,
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      counter_transaction: { include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } } },
      attachment: true,
      costCenter: { include: { budget_plan: true } },
    } as any,
  });

  const transactions: Transaction[] = txsRaw.map((tx: any) => {
    const main = tx.account ? inferOtherFromAccount(tx.account) : null;
    const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
    const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
    return {
      id: tx.id,
      amount: Number(tx.amount),
      date: (tx.date ?? tx.date_valued ?? new Date()).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other,
      main,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
      costCenterLabel,
      bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
    };
  });

  return NextResponse.json(transactions);
}
