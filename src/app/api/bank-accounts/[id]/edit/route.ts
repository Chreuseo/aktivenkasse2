import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, getUserIdFromRequest } from "@/services/authService";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const userId = await getUserIdFromRequest(req);
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const acc = await prisma.bankAccount.findUnique({ where: { id: idNum } });
  if (!acc) return NextResponse.json({ error: "Bankkonto nicht gefunden" }, { status: 404 });
  // Admin-/Globale Berechtigung zuerst prüfen
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf bank_accounts" }, { status: 403 });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, bank, iban, bic, payment_method } = data ?? {};
  if (!name || !bank || !iban) return NextResponse.json({ error: "Name, Bank und IBAN sind erforderlich" }, { status: 400 });
  // Update BankAccount inkl. payment_method (boolean cast)
  await prisma.bankAccount.update({
    where: { id: idNum },
    data: {
      name,
      bank,
      iban,
      bic,
      payment_method: !!payment_method,
    },
  });
  return NextResponse.json({ success: true });
}
