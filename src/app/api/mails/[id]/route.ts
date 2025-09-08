import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.mails, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.error || "Nicht erlaubt" }, { status: 403 });
  }

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  try {
    const mail = await prisma.mail.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!mail) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

    return NextResponse.json({
      id: mail.id,
      subject: mail.subject,
      body: mail.body,
      sentAt: mail.sentAt,
      addressedTo: mail.addressedTo,
      attachment: mail.attachment,
      user: mail.user ? { id: mail.user.id, first_name: mail.user.first_name, last_name: mail.user.last_name } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Fehler beim Laden der Mail" }, { status: 500 });
  }
}
