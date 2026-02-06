import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      account: true,
    },
  });
  if (!user) return NextResponse.json({ error: "User nicht gefunden" }, { status: 404 });

  const accountId = user.accountId || (user as any).account?.id;

  const [transactionsAll, allowances] = await Promise.all([
    accountId
      ? prisma.transaction.findMany({
          where: { accountId },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
    accountId
      ? prisma.allowance.findMany({
          where: { accountId },
          orderBy: { date: "desc" },
          include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } },
        })
      : Promise.resolve([]),
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
  });

  const planned = transactionsAll.filter(t => !t.processed).map(mapTx);
  const past = transactionsAll.filter(t => t.processed).map(mapTx);

  return NextResponse.json({
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      mail: user.mail,
      balance: user.account ? Number((user as any).account.balance) : 0,
      accountId: accountId || null,
    },
    planned,
    past,
    allowances,
  });
}
