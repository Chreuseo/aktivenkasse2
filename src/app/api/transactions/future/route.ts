import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

function inferAccount(acc: any) {
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
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const bankAccountId = searchParams.get("bankAccountId");
  const clearingAccountId = searchParams.get("clearingAccountId");

  const where: any = { processed: false };
  if (userId) where.account = { users: { some: { id: Number(userId) } } };
  if (bankAccountId) where.account = { bankAccounts: { some: { id: Number(bankAccountId) } } };
  if (clearingAccountId) where.account = { clearingAccounts: { some: { id: Number(clearingAccountId) } } };

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: [{ date_valued: "asc" }, { date: "asc" }, { id: "asc" }],
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      costCenter: { include: { budget_plan: true } },
      attachment: true,
    } as any,
  });

  const result = txs.map((tx: any) => {
    const main = tx.account ? inferAccount(tx.account) : null;
    const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
    const amount = Number(tx.amount);
    return {
      id: tx.id,
      amount,
      date: (tx.date_valued ?? tx.date ?? new Date()).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      processed: !!tx.processed,
      main,
      other: null,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
      costCenterLabel,
      bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
      costCenterId: tx.costCenterId || (tx.costCenter ? tx.costCenter.id : undefined),
      budgetPlanId: tx.costCenter && tx.costCenter.budget_plan ? tx.costCenter.budget_plan.id : undefined,
    };
  });

  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id");
  if (!idParam) return NextResponse.json({ error: "id ist Pflicht" }, { status: 400 });
  const txId = Number(idParam);

  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    select: { id: true, processed: true, counter_transactionId: true, transactionBulkId: true },
  });
  if (!tx) return NextResponse.json({ error: "Transaktion nicht gefunden" }, { status: 404 });
  if (tx.processed) return NextResponse.json({ error: "Transaktion ist bereits gebucht" }, { status: 409 });

  try {
    await prisma.$transaction(async (p) => {
      // 1) Falls Transaktion Haupttransaktion eines Bulks ist, muss zuerst der Bulk gelöscht werden.
      //    Grund: TransactionBulk.transactionId zeigt auf diese Transaktion.
      const bulkAsMain = await p.transactionBulk.findFirst({
        where: { transactionId: txId },
        select: { id: true },
      });
      if (bulkAsMain) {
        // Alle Bulk-Transaktionen (inkl mainTx selbst) löschen
        await p.transaction.deleteMany({ where: { transactionBulkId: bulkAsMain.id } });
        await p.transactionBulk.delete({ where: { id: bulkAsMain.id } });
        return;
      }

      // 2) Falls Gegenbuchung existiert (Paired-Tx), beide löschen
      if (tx.counter_transactionId) {
        const c = await p.transaction.findUnique({ where: { id: tx.counter_transactionId }, select: { id: true, processed: true } });
        if (!c) throw new Error("Gegenbuchung nicht gefunden");
        if (c.processed) throw new Error("Gegenbuchung ist bereits gebucht");
        await p.transaction.delete({ where: { id: c.id } });
      }

      // 3) Normale (ggf. Bulk-Row) Transaktion löschen
      await p.transaction.delete({ where: { id: txId } });
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
