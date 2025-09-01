import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";

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
  // Transaktionen des zugehörigen Accounts auslesen
  let transactions: any[] = [];
  if (ca.account) {
    transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { accountId1: ca.account.id },
          { accountId2: ca.account.id },
        ],
      },
      orderBy: { date: "desc" },
      include: {
        account1: {
          include: {
            users: true,
            bankAccounts: true,
            clearingAccounts: true,
          },
        },
        account2: {
          include: {
            users: true,
            bankAccounts: true,
            clearingAccounts: true,
          },
        },
      },
    });
  }
  // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
  const txs = transactions.map(tx => {
    let isMain = tx.accountId1 === ca.account.id;
    let amount = isMain ? (tx.account1Negative ? -tx.amount : tx.amount) : (tx.account2Negative ? -tx.amount : tx.amount);
    let otherAccount = isMain ? tx.account2 : tx.account1;
    let otherType = otherAccount?.type;
    let otherDetails = null;
    if (otherAccount) {
      if (otherType === "user" && otherAccount.users?.length) {
        otherDetails = {
          type: "user",
          name: otherAccount.users[0].first_name + " " + otherAccount.users[0].last_name,
          mail: otherAccount.users[0].mail,
        };
      } else if (otherType === "bank" && otherAccount.bankAccounts?.length) {
        otherDetails = {
          type: "bank",
          name: otherAccount.bankAccounts[0].name,
          bank: otherAccount.bankAccounts[0].bank,
          iban: otherAccount.bankAccounts[0].iban,
        };
      } else if (otherType === "clearing_account" && otherAccount.clearingAccounts?.length) {
        otherDetails = {
          type: "clearing_account",
          name: otherAccount.clearingAccounts[0].name,
        };
      }
    }
    return {
      id: tx.id,
      amount,
      date: tx.date.toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other: otherDetails,
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
