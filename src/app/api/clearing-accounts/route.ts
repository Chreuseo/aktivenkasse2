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

export async function POST(req: Request) {
  // write_all auf clearing_accounts erforderlich
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf clearing_accounts" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }

  const { name, responsibleId, reimbursementEligible } = body || {};
  const interest = typeof body?.interest === 'boolean' ? Boolean(body.interest) : false; // Default: false
  if (!name) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  // Optional: Verantwortlichen prüfen
  let responsibleUser: { id: number } | null = null;
  if (responsibleId) {
    const rid = Number(responsibleId);
    if (!Number.isFinite(rid)) {
      return NextResponse.json({ error: "Ungültige responsibleId" }, { status: 400 });
    }
    responsibleUser = await prisma.user.findUnique({ where: { id: rid }, select: { id: true } });
    if (!responsibleUser) {
      return NextResponse.json({ error: "Verantwortlicher User nicht gefunden" }, { status: 404 });
    }
  }

  try {
    const created = await prisma.$transaction(async (p) => {
      const account = await p.account.create({ data: { balance: 0, interest: interest, type: "clearing_account" } });
      const ca = await p.clearingAccount.create({
        data: {
          name: String(name),
          ...(responsibleUser ? { responsible: { connect: { id: responsibleUser.id } } } : {}),
          reimbursementEligible: Boolean(reimbursementEligible),
          account: { connect: { id: account.id } },
        },
        select: { id: true, name: true, responsibleId: true, reimbursementEligible: true, accountId: true },
      });
      return ca;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    console.error("POST /api/clearing-accounts failed", e);
    return NextResponse.json({ error: "Fehler beim Anlegen des Verrechnungskontos", detail: e?.message }, { status: 400 });
  }
}
