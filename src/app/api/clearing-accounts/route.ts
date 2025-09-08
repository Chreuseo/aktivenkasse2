import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf clearing_accounts" }, { status: 403 });
  }

  try {
    const items = await prisma.clearingAccount.findMany({
      include: {
        responsible: true,
        account: true,
        members: { include: { user: true } },
      },
      orderBy: { name: "asc" },
    });

    const result = items.map((ca: any) => ({
      id: ca.id,
      name: ca.name,
      responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
      responsibleMail: ca.responsible ? ca.responsible.mail : null,
      balance: ca.account?.balance ? Number(ca.account.balance) : 0,
      reimbursementEligible: Boolean(ca.reimbursementEligible),
      members: (ca.members || []).map((m: any) => ({
        id: m.user.id,
        name: `${m.user.first_name} ${m.user.last_name}`,
        mail: m.user.mail,
      })),
    }));

    return NextResponse.json(result);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Fehler beim Laden der Verrechnungskonten", detail: e?.message }, { status: 500 });
  }
}
