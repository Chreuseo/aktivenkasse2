import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";
import {getClearingAccountRole} from "@/lib/getUserAuthContext";

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

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const keycloakId = getUserIdFromRequest(req);
  if (!keycloakId) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
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
  const user_role = await getClearingAccountRole(idNum, keycloakId);
  switch (user_role) {
    case "none": {
      const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
      if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_all auf clearing_accounts" }, { status: 403 });
      }
      break;
    }
    case "responsible": {
      const perm_resp = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
      if (!perm_resp.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_own auf clearing_accounts" }, { status: 403 });
      }
      break;
    }
    case "member": {
      const perm_member = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
      if (!perm_member.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_own auf clearing_accounts" }, { status: 403 });
      }
      break;
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
        costCenter: { include: { budget_plan: true } },
        attachment: true,
      },
    });
  }
  // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
  const txs = transactions.map((tx: any) => {
    const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
    const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
    return {
      id: tx.id,
      amount: Number(tx.amount),
      date: (tx.date_valued ?? tx.date).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
      costCenterLabel,
      bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
    };
  });

  // Mitglieder in das erwartete Frontend-Format mappen
  const members = (ca.members || []).map((m: any) => ({
    id: m.user.id,
    name: `${m.user.first_name} ${m.user.last_name}`,
    mail: m.user.mail,
  }));

  return NextResponse.json({
    id: ca.id,
    name: ca.name,
    responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
    responsibleMail: ca.responsible ? ca.responsible.mail : null,
    responsibleId: ca.responsibleId ?? null,
    balance: ca.account?.balance ? Number(ca.account.balance) : 0,
    reimbursementEligible: ca.reimbursementEligible,
    interest: !!ca.account?.interest,
    members,
    transactions: txs,
  });
}
