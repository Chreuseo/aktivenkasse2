import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission, getUserIdFromRequest} from "@/services/authService";
import {clearing_account_roles, getClearingAccountRole} from "@/lib/getUserAuthContext";

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const keycloakId = getUserIdFromRequest(req);
  if (!keycloakId) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const ca = await prisma.clearingAccount.findUnique({ where: { id: idNum } });
  if (!ca) return NextResponse.json({ error: "Verrechnungskonto nicht gefunden" }, { status: 404 });
  // Admin-/Globale Berechtigung zuerst prüfen

  const user_role = await getClearingAccountRole(idNum, keycloakId);
  switch (user_role) {
    case clearing_account_roles.none:
      const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
      if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für write_all auf clearing_accounts" }, { status: 403 });
      }
      break;
    case clearing_account_roles.responsible:
      break;
    case clearing_account_roles.member:
      const perm_member = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.write_all);
      if (!perm_member.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für write_all auf clearing_accounts" }, { status: 403 });
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
      responsibleId: responsible ? (responsible as any).id : null,
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
