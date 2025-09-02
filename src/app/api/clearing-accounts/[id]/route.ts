import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";

function inferOtherFromAccount(acc: any) {
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

export async function GET(req: Request, context: any) {
  const { id } = await context.params;
  const userId = await getUserIdFromRequest(req);
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const ca = await prisma.clearingAccount.findUnique({
    where: { id: idNum },
    include: {
      responsible: true,
      account: true,
      members: { include: { user: true } },
    },
  });
  if (!ca) return NextResponse.json({ error: "Verrechnungskonto nicht gefunden" }, { status: 404 });
  // Berechtigungsprüfung
  const permAll = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
  let canEdit = false;
  if (permAll.allowed) {
    canEdit = true;
  } else {
    const isResponsible = ca.responsibleId === Number(userId);
    if (isResponsible) {
      const permOwn = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
      if (permOwn.allowed) {
        canEdit = true;
      }
    }
  }
  // Transaktionen des zugehörigen Accounts (neues Schema)
  let transactions: any[] = [];
  if (ca.account) {
    transactions = await prisma.transaction.findMany({
      where: { accountId: ca.account.id },
      orderBy: { date: "desc" },
      include: {
        counter_transaction: {
          include: {
            account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
          },
        },
      },
    });
  }
  // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
  const txs = transactions.map((tx: any) => {
    const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
    return {
      id: tx.id,
      amount: Number(tx.amount),
      date: (tx.date_valued ?? tx.date).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/attachments/${tx.attachmentId}/download` : undefined,
    };
  });
  return NextResponse.json({
    id: ca.id,
    name: ca.name,
    responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
    responsibleMail: ca.responsible ? ca.responsible.mail : null,
    balance: ca.account?.balance ? Number(ca.account.balance) : 0,
    reimbursementEligible: ca.reimbursementEligible,
    // Mitglieder werden entfernt
    // members: ca.members.map(m => m.user ? { id: m.user.id, name: `${m.user.first_name} ${m.user.last_name}`, mail: m.user.mail } : null).filter(Boolean),
    canEdit,
    transactions: txs,
  });
}
