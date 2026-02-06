import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";

export async function GET(req: Request) {
  // Nur eigene Daten lesen
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_own);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_own auf userAuth" }, { status: 403 });
  }

  try {
    const { userId: tokenUserId } = extractTokenAndUserId(req as any);
    if (!tokenUserId) {
      return NextResponse.json({ error: "Keine UserId im Token" }, { status: 401 });
    }

    // Nutzer anhand Keycloak-ID (sub) oder numerischer ID finden
    const where: any = isNaN(Number(tokenUserId))
      ? { keycloak_id: String(tokenUserId) }
      : { id: Number(tokenUserId) };

    const user = await prisma.user.findUnique({ where, include: { account: true } });
    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }

    const accountId = user.accountId;

    const [transactionsRaw, allowances] = await Promise.all([
      prisma.transaction.findMany({
        where: { accountId },
        orderBy: { date: "desc" },
        include: {
          counter_transaction: {
            include: {
              account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
            },
          },
          costCenter: { include: { budget_plan: true } },
          attachment: true,
        },
      }),
      prisma.allowance.findMany({
        where: { accountId },
        orderBy: { date: "desc" },
        include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } },
      }),
    ]);

    const txDto = (tx: any) => {
      const other = tx.counter_transaction
        ? (() => {
            const acc = tx.counter_transaction.account;
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
          })()
        : null;
      const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
      return {
        id: tx.id,
        amount: Number(tx.amount),
        date: (tx.date_valued ?? tx.date).toISOString(),
        description: tx.description,
        reference: tx.reference || undefined,
        other,
        processed: !!tx.processed,
        attachmentId: tx.attachmentId || undefined,
        receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
        costCenterLabel,
        bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
      };
    };

    const planned = transactionsRaw.filter(t => !t.processed).map(txDto);
    const past = transactionsRaw.filter(t => t.processed).map(txDto);

    return NextResponse.json({
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        mail: user.mail,
        balance: user.account?.balance ? Number(user.account.balance) : 0,
        accountId,
      },
      planned,
      past,
      allowances,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Laden der Nutzerdaten", detail: error?.message }, { status: 500 });
  }
}
