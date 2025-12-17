import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: NextRequest, context: any) {
  const id = Number(context.params.id);
  if (!id || isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const cc = await prisma.clearingAccount.findUnique({ where: { id }, include: { account: true } });
  if (!cc) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(cc);
}
