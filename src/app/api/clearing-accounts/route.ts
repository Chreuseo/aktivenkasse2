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

export async function POST(req: Request) {
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf clearing_accounts" }, { status: 403 });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, responsibleId, reimbursementEligible, members } = data;
  if (!name) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  // Prüfe, ob Verantwortlicher existiert, aber nur wenn angegeben
  let responsible = null;
  if (responsibleId) {
    responsible = await prisma.user.findUnique({ where: { id: Number(responsibleId) } });
    if (!responsible) {
      return NextResponse.json({ error: "Verantwortlicher User nicht gefunden" }, { status: 404 });
    }
  }
  // Account für das Verrechnungskonto anlegen
  const account = await prisma.account.create({
    data: {
      balance: 0,
      interest: false,
      type: "clearing_account",
    },
  });
  // Verrechnungskonto anlegen
  const clearingAccount = await prisma.clearingAccount.create({
    data: {
      name,
      responsibleId: responsible ? responsible.id : null,
      accountId: account.id,
      reimbursementEligible: !!reimbursementEligible,
    },
  });
  // Mitglieder zuweisen (optional)
  let memberIds: number[] = [];
  if (members && typeof members === "string" && members.trim().length > 0) {
    memberIds = members.split(",").map((id: string) => Number(id.trim())).filter((id: number) => !isNaN(id));
    for (const userId of memberIds) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await prisma.clearingAccountMember.create({
          data: {
            clearingAccountId: clearingAccount.id,
            userId: user.id,
          },
        });
      }
    }
  }
  return NextResponse.json({
    id: clearingAccount.id,
    name: clearingAccount.name,
    responsible: responsible ? `${responsible.first_name} ${responsible.last_name}` : null,
    reimbursementEligible: clearingAccount.reimbursementEligible,
    members: memberIds,
  });
}
