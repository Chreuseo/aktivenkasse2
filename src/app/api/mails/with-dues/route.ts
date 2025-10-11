import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { sendMails, type MailBuildInput, type DbUserForMail, type DbClearingForMail } from "@/services/mailService";
import { getToken } from "next-auth/jwt";

type ApiResponse = {
  total: number;
  success: number;
  failed: number;
  errors: { to: string; error: string }[];
  duesCreated: number;
};

// POST /api/mails/with-dues
// Body: { recipients: { type: "user"|"clearing", ids: number[] }, remark?: string, subject?: string }
// Wirkung: Versendet Mails wie /api/mails und erzeugt zusätzlich Fälligkeiten (dues) für betroffene Accounts

function getEnvMulti(keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim().length) return String(v);
  }
  return fallback;
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as any)?.toNumber === "function") return (v as any).toNumber();
  const s = String(v);
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type Recipients = { type: "user" | "clearing"; ids: number[] };

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Permission identisch zu /api/mails
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

  // Initiator (Name + Mail) ermitteln
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

  // Empfänger laden
  let inputs: MailBuildInput[];
  if (body.recipients.type === "user") {
    const items = await prisma.user.findMany({ where: { id: { in: ids } }, include: { account: true } });
    inputs = items.map((u) => ({
      kind: "user",
      user: {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        mail: u.mail,
        account: {
          id: (u as any).account?.id,
          balance: (u as any).account?.balance,
          interest: (u as any).account?.interest,
        },
      } as DbUserForMail,
    }));
  } else {
    const items = await prisma.clearingAccount.findMany({
      where: { id: { in: ids }, NOT: { responsibleId: null } },
      include: { account: true, responsible: true },
    });
    inputs = items
      .filter((c) => !!c.responsible)
      .map((c) => ({
        kind: "clearing",
        clearing: {
          name: c.name,
          account: {
            id: (c as any).account?.id,
            balance: (c as any).account?.balance,
            interest: (c as any).account?.interest,
          },
          responsible: {
            id: (c as any).responsible?.id,
            first_name: (c as any).responsible?.first_name,
            last_name: (c as any).responsible?.last_name,
            mail: (c as any).responsible?.mail,
          },
        } as DbClearingForMail,
      }));
  }

  if (!inputs.length) {
    return NextResponse.json({ error: "Keine gültigen Empfänger gefunden" }, { status: 404 });
  }

  // 1) Mails senden (wie gehabt)
  const { success, errors } = await sendMails(inputs, body.remark, initiatorName, initiatorEmail, body.subject);

  // 2) Fälligkeiten erzeugen: nur für Konten mit negativem Kontostand
  const defaultDaysStr = getEnvMulti(["DUE_DEFAULT_DAYS", "DUES_DEFAULT_DAYS", "due.default.days"], "14");
  const defaultDays = Number.parseInt(defaultDaysStr, 10);
  const days = Number.isFinite(defaultDays) && defaultDays > 0 ? defaultDays : 14;
  const now = new Date();
  const dueDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const duesCreates: Parameters<typeof prisma.dues.create>[0][] = [];
  for (const inp of inputs) {
    const acc = inp.kind === "user" ? (inp.user as any).account : (inp.clearing as any).account;
    const accountId = (acc?.id ?? null) as number | null;
    const balNum = decimalToNumber(acc?.balance);
    if (!accountId) continue;
    if (balNum < 0) {
      const amountStr = (-balNum).toFixed(2); // als String für Decimal-Feld
      duesCreates.push({ data: { accountId, amount: amountStr as unknown as any, dueDate } });
    }
  }

  let duesCreated = 0;
  if (duesCreates.length > 0) {
    await prisma.$transaction(duesCreates.map((args) => prisma.dues.create(args)));
    duesCreated = duesCreates.length;
  }

  const response: ApiResponse = { total: inputs.length, success, failed: errors.length, errors, duesCreated };
  return NextResponse.json(response);
}
