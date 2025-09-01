import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";

export async function PUT(req: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const userId = await getUserIdFromRequest(req);
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const ca = await prisma.clearingAccount.findUnique({ where: { id: idNum } });
  if (!ca) return NextResponse.json({ error: "Verrechnungskonto nicht gefunden" }, { status: 404 });
  // Admin-/Globale Berechtigung zuerst prüfen
  const permAll = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
  if (!permAll.allowed) {
    // Nur Verantwortlicher darf schreiben
    const isResponsible = ca.responsibleId === Number(userId);
    if (!isResponsible) {
      return NextResponse.json({ error: "Nur der Verantwortliche darf Änderungen vornehmen" }, { status: 403 });
    }
    const permOwn = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
    if (!permOwn.allowed) {
      return NextResponse.json({ error: "Keine Berechtigung für read_own auf clearing_accounts" }, { status: 403 });
    }
  }
  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, responsibleId, reimbursementEligible, memberIds } = data;
  if (!name) return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  // Verantwortlichen prüfen
  let responsible = null;
  if (responsibleId) {
    responsible = await prisma.user.findUnique({ where: { id: Number(responsibleId) } });
    if (!responsible) return NextResponse.json({ error: "Verantwortlicher User nicht gefunden" }, { status: 404 });
  }
  // Update ClearingAccount
  await prisma.clearingAccount.update({
    where: { id: idNum },
    data: {
      name,
      responsibleId: responsible ? responsible.id : null,
      reimbursementEligible: !!reimbursementEligible,
    },
  });
  // Mitglieder aktualisieren (ersetzen)
  if (Array.isArray(memberIds)) {
    await prisma.clearingAccountMember.deleteMany({ where: { clearingAccountId: idNum } });
    for (const userId of memberIds) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await prisma.clearingAccountMember.create({
          data: { clearingAccountId: idNum, userId: user.id },
        });
      }
    }
  }
  return NextResponse.json({ success: true });
}

