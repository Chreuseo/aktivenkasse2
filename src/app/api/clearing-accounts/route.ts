// Datei: src/app/api/clearing-accounts/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  // Berechtigungsprüfung: read_all für clearing_accounts
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf clearing_accounts" }, { status: 403 });
  }

  try {
    const clearingAccounts = await prisma.clearingAccount.findMany({
      include: {
        responsible: true,
        account: { select: { balance: true } },
        members: { include: { user: true } },
      },
    });
    const result = clearingAccounts.map(ca => ({
      id: ca.id,
      name: ca.name,
      responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
      balance: ca.account?.balance ? Number(ca.account.balance) : 0,
      reimbursementEligible: ca.reimbursementEligible,
      members: ca.members.map(m => m.user ? `${m.user.first_name} ${m.user.last_name}` : null).filter(Boolean),
    }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Laden der Verrechnungskonten", detail: error?.message }, { status: 500 });
  }
}
