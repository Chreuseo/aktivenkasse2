import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: NextRequest, ctx: any) {
  const { id } = ctx.params;
  const mailId = Number(id);
  if (!mailId || isNaN(mailId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.mails, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const mail = await prisma.mail.findUnique({ where: { id: mailId } });
  if (!mail) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(mail);
}
