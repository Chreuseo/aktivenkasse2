import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import type { Transaction } from "@/app/types/transaction";
import { checkPermission } from "@/services/authService";
import { getToken } from "next-auth/jwt";

function inferOtherFromAccount(acc: any): Transaction["main"] {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return { type: "user", name: `${u.first_name} ${u.last_name}`, mail: u.mail } as any;
  }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return { type: "bank", name: b.name, bank: b.bank, iban: b.iban } as any;
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return { type: "clearing_account", name: c.name } as any;
  }
  return null;
}

export async function GET(req: Request) {
  // Erst: read_all prüfen
  const permAll = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);

  let whereFilter: any = {
    counter_transactionId: null,
    counter_transactions: { none: {} },
  };

  if (!permAll.allowed) {
    // Fallback: read_own
    const permOwn = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_own);
    if (!permOwn.allowed) {
      const status = permOwn.error === "Kein Token" || permOwn.error === "Keine UserId im Token" ? 401 : 403;
      return NextResponse.json({ error: permOwn.error || "Forbidden" }, { status });
    }
    // Nutzer-ID ermitteln (Keycloak sub -> DB-User)
    const token: any = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
    const keycloakId = token?.user?.sub || token?.sub;
    if (!keycloakId) return NextResponse.json({ error: "Keine UserId im Token" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { keycloak_id: keycloakId }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 403 });
    whereFilter = { ...whereFilter, createdById: user.id };
  }

  const txsRaw = await prisma.transaction.findMany({
    where: whereFilter,
    orderBy: { date: "desc" },
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      attachment: true,
      costCenter: { include: { budget_plan: true } },
    } as any,
  });

  const transactions: Transaction[] = txsRaw.map((tx: any) => {
    const main = tx.account ? inferOtherFromAccount(tx.account) : null;
    const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
    return {
      id: tx.id,
      amount: -Number(tx.amount), // Negiert anzeigen, wie bisher in der Page
      date: (tx.date ?? tx.date_valued ?? new Date()).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other: null,
      main,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
      costCenterLabel,
      bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
    };
  });

  return NextResponse.json(transactions);
}
