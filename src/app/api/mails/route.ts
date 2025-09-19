import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { sendMails, type MailBuildInput } from "@/services/mailService";
import { getToken } from "next-auth/jwt";

// POST /api/mails
// Body: { recipients: { type: "user"|"clearing", ids: number[] }, remark?: string, subject?: string }
// Requires: write_all on mails

type Recipients = { type: "user" | "clearing"; ids: number[] };

export async function POST(req: NextRequest) {
  // Permission
  const perm = await checkPermission(req as unknown as Request, ResourceType.mails, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.error || "Nicht erlaubt" }, { status: 403 });
  }

  let body: { recipients?: Recipients; remark?: string; subject?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body" }, { status: 400 });
  }

  if (!body?.recipients || !Array.isArray(body.recipients.ids) || body.recipients.ids.length === 0) {
    return NextResponse.json({ error: "recipients.ids erforderlich" }, { status: 400 });
  }
  if (body.recipients.type !== "user" && body.recipients.type !== "clearing") {
    return NextResponse.json({ error: "recipients.type muss 'user' oder 'clearing' sein" }, { status: 400 });
  }

  const ids = body.recipients.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (!ids.length) {
    return NextResponse.json({ error: "recipients.ids leer" }, { status: 400 });
  }

  // Initiator-Name + Mail ermitteln (Header oder NextAuth-Token)
  let { userId } = extractTokenAndUserId(req as any);
  if (!userId) {
    try {
      const t: any = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
      if (t) {
        userId = t.sub || t.userId || t.id || t.user?.sub || null;
      }
    } catch {}
  }

  let initiatorName = "Unbekannt";
  let initiatorEmail: string | null = null;
  if (userId) {
    const initiator = isNaN(Number(userId))
      ? await prisma.user.findUnique({ where: { keycloak_id: userId } })
      : await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (initiator) {
      initiatorName = `${initiator.first_name} ${initiator.last_name}`;
      initiatorEmail = initiator.mail;
    }
  }

  // Empfänger laden und Input für Mailservice bauen
  let inputs: MailBuildInput[] = [];
  if (body.recipients.type === "user") {
    const items = await prisma.user.findMany({ where: { id: { in: ids } }, include: { account: true } });
    inputs = items.map((u) => ({ kind: "user", user: u }));
  } else {
    const items = await prisma.clearingAccount.findMany({
      where: { id: { in: ids }, NOT: { responsibleId: null } },
      include: { account: true, responsible: true },
    });
    // filter Sicherheitsnetz: nur mit verantwortlichem Nutzer
    inputs = items.filter((c) => !!c.responsible).map((c) => ({ kind: "clearing", clearing: c as any }));
  }

  if (!inputs.length) {
    return NextResponse.json({ error: "Keine gültigen Empfänger gefunden" }, { status: 404 });
  }

  const { success, errors } = await sendMails(inputs, body.remark, initiatorName, initiatorEmail, body.subject);

  return NextResponse.json({ total: inputs.length, success, failed: errors.length, errors });
}

export async function GET(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.mails, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.error || "Nicht erlaubt" }, { status: 403 });
  }

  try {
    const mails = await prisma.mail.findMany({
      orderBy: { sentAt: "desc" },
      include: { user: true },
    });

    const result = mails.map((m) => ({
      id: m.id,
      subject: m.subject,
      sentAt: m.sentAt,
      user: m.user ? { id: m.user.id, first_name: m.user.first_name, last_name: m.user.last_name } : null,
    }));

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: "Fehler beim Laden der Mails" }, { status: 500 });
  }
}
