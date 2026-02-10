import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const bankAccount = await prisma.bankAccount.findUnique({
    where: { id },
    include: {
      account: true,
    },
  });
  if (!bankAccount) return NextResponse.json({ error: "Bankkonto nicht gefunden" }, { status: 404 });

  const [transactionsAll, allowances] = await Promise.all([
    prisma.transaction.findMany({
      where: { accountId: bankAccount.accountId },
      orderBy: { date: "desc" },
      include: { costCenter: { include: { budget_plan: true } }, attachment: true },
    }),
    prisma.allowance.findMany({
      where: { accountId: bankAccount.accountId },
      orderBy: { date: "desc" },
      include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } },
    }),
  ]);

  const mapTx = (tx: any) => ({
    id: tx.id,
    amount: Number(tx.amount),
    date: (tx.date_valued ?? tx.date).toISOString(),
    description: tx.description,
    reference: tx.reference || undefined,
    processed: !!tx.processed,
    attachmentId: tx.attachmentId || undefined,
    receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
    costCenterLabel: tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined,
  });

  const planned = transactionsAll.filter(t => !t.processed).map(mapTx);
  const past = transactionsAll.filter(t => !!t.processed).map(mapTx);

  const flatBankAccount = {
    id: bankAccount.id,
    name: bankAccount.name,
    owner: bankAccount.owner,
    bank: bankAccount.bank,
    iban: bankAccount.iban,
    balance: Number(bankAccount.account.balance),
    accountId: bankAccount.accountId,
  };

  return NextResponse.json({ bankAccount: flatBankAccount, planned, past, allowances });
}
