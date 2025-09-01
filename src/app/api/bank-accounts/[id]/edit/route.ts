import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";

export async function PUT(req: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const userId = await getUserIdFromRequest(req);
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const acc = await prisma.bankAccount.findUnique({ where: { id: idNum } });
  if (!acc) return NextResponse.json({ error: "Bankkonto nicht gefunden" }, { status: 404 });
  // Admin-/Globale Berechtigung zuerst prüfen
  const permAll = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.write_all);
  // Debug: Header, UserId, Permission loggen
  const debugInfo = {
    headers: Object.fromEntries(req.headers.entries()),
    userId,
    permAll,
  };
  if (!permAll.allowed) {
    const permOwn = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_own);
    debugInfo.permOwn = permOwn;
    if (!permOwn.allowed) {
      return NextResponse.json({ error: "Keine Berechtigung für read_own auf bank_accounts", debug: debugInfo }, { status: 403 });
    }
  }
  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, bank, iban, bic } = data;
  if (!name || !bank || !iban) return NextResponse.json({ error: "Name, Bank und IBAN sind erforderlich" }, { status: 400 });
  // Update BankAccount
  await prisma.bankAccount.update({
    where: { id: idNum },
    data: {
      name,
      bank,
      iban,
      bic,
    },
  });
  return NextResponse.json({ success: true });
}
