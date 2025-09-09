import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { getToken } from "next-auth/jwt";

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);

  let whereFilter: any = {};

  if (!perm.allowed) {
    const permOwn = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
    if (!permOwn.allowed) {
      return NextResponse.json({ error: "Keine Berechtigung für read_all oder read_own auf clearing_accounts" }, { status: 403 });
    } else {
      // read_own: nur Konten, bei denen der Nutzer verantwortlich ist oder Mitglied
      const token: any = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
      const keycloakId = token?.user?.sub || token?.sub;
      if (!keycloakId) {
        return NextResponse.json({ error: "Keine UserId im Token" }, { status: 401 });
      }
      const user = await prisma.user.findUnique({ where: { keycloak_id: keycloakId }, select: { id: true } });
      if (!user) {
        return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 403 });
      }
      whereFilter = {
        OR: [
          { responsibleId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      };
    }
  }

  try {
    const items = await prisma.clearingAccount.findMany({
      where: whereFilter,
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
