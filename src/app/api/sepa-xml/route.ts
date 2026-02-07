import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";
import { getToken } from "next-auth/jwt";
import { getSepaConfig } from "@/lib/sepaConfig";
import { buildSepaPain008Xml } from "@/lib/sepaXml";
import { createPairedTransactions } from "@/services/transactionService";
import { sendMails, type MailBuildInput } from "@/services/mailService";

type Body = {
  recipientIds: number[];
  filterOp?: "kleiner" | "größer" | "ungleich" | "Betrag größer";
  filterAmount?: number;
  collectionDate: string; // ISO
  bankAccountId: number; // Kreditor-/Einzugskonto
  remark?: string;
  sendInfoMail?: boolean;
  createTransactions?: boolean;
  remittanceGlobal: string;
  remittanceByUserId?: Record<string, string>;
};

function asNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeString(v: any): string {
  return String(v ?? "").trim();
}

function parseDate(v: any): Date | null {
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export async function POST(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.error || "Nicht erlaubt" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body" }, { status: 400 });
  }

  const recipientIds = Array.isArray(body?.recipientIds) ? body.recipientIds.map(asNumber).filter(Number.isFinite) : [];
  if (!recipientIds.length) return NextResponse.json({ error: "recipientIds erforderlich" }, { status: 400 });

  const collectionDate = parseDate(body?.collectionDate);
  if (!collectionDate) return NextResponse.json({ error: "collectionDate ungültig" }, { status: 400 });

  const bankAccountId = asNumber(body?.bankAccountId);
  if (!Number.isFinite(bankAccountId)) return NextResponse.json({ error: "bankAccountId ungültig" }, { status: 400 });

  const remittanceGlobal = normalizeString(body?.remittanceGlobal);
  if (!remittanceGlobal) {
    return NextResponse.json({ error: "Verwendungszweck (global) ist Pflicht" }, { status: 400 });
  }

  let config;
  try {
    config = getSepaConfig();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "SEPA Konfiguration fehlt" }, { status: 500 });
  }

  // Initiator bestimmen (wie Mails)
  let { userId } = extractTokenAndUserId(req as any);
  if (!userId) {
    try {
      const t: any = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
      if (t) userId = t.sub || t.userId || t.id || t.user?.sub || null;
    } catch {}
  }

  const initiator = userId
    ? (isNaN(Number(userId))
        ? await prisma.user.findUnique({ where: { keycloak_id: String(userId) } })
        : await prisma.user.findUnique({ where: { id: Number(userId) } }))
    : null;

  const createdById: number | null = initiator?.id ?? null;
  if (!createdById) {
    return NextResponse.json({ error: "CreatedBy konnte nicht ermittelt werden (Login?)" }, { status: 401 });
  }

  const initiatorName = initiator ? `${initiator.first_name} ${initiator.last_name}` : "Aktivenkasse";
  const initiatorEmail = initiator?.mail ?? null;

  // Bankkonto (Kreditor)
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return NextResponse.json({ error: "Bankkonto nicht gefunden" }, { status: 404 });

  // Nutzer laden
  const users = await prisma.user.findMany({
    where: { id: { in: recipientIds }, enabled: true },
    include: { account: true },
  });

  const byId = new Map(users.map((u) => [u.id, u]));
  const missingUsers = recipientIds.filter((id) => !byId.has(id));

  const errors: Array<{ userId: number; name: string; error: string }> = [];

  const debtors = recipientIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((u: any) => {
      const name = `${u.first_name} ${u.last_name}`.trim();
      const balance = u.account ? Number(u.account.balance) : 0;

      // Einzug: nur bei negativem Kontostand => Betrag = abs(balance)
      // Bei positiven Salden würde ein "Einzug" fachlich keinen Sinn machen.
      if (!(balance < 0)) {
        errors.push({ userId: u.id, name, error: `Kontostand nicht negativ (${formatCurrency(balance)})` });
        return null;
      }

      if (!u.sepa_mandate) {
        errors.push({ userId: u.id, name, error: "Kein aktives SEPA-Mandat" });
        return null;
      }
      if (!u.sepa_mandate_reference || !String(u.sepa_mandate_reference).trim()) {
        errors.push({ userId: u.id, name, error: "Mandatsreferenz fehlt" });
        return null;
      }
      if (!u.sepa_mandate_date) {
        errors.push({ userId: u.id, name, error: "Mandatsdatum fehlt" });
        return null;
      }
      if (!u.sepa_iban || !String(u.sepa_iban).trim()) {
        errors.push({ userId: u.id, name, error: "IBAN fehlt" });
        return null;
      }

      const specific = body?.remittanceByUserId ? normalizeString((body.remittanceByUserId as any)[String(u.id)]) : "";
      const remittance = specific ? `${remittanceGlobal} - ${specific}` : remittanceGlobal;

      return {
        userId: u.id,
        name,
        iban: String(u.sepa_iban).trim(),
        bic: u.sepa_bic ? String(u.sepa_bic).trim() : null,
        mandateId: String(u.sepa_mandate_reference).trim(),
        mandateDate: new Date(u.sepa_mandate_date),
        amount: Math.round(Math.abs(balance) * 100) / 100,
        remittanceInformation: remittance,
      };
    })
    .filter(Boolean) as Array<any>;

  if (missingUsers.length) {
    missingUsers.forEach((id) => errors.push({ userId: id, name: "-", error: "User nicht gefunden" }));
  }

  if (!debtors.length) {
    return NextResponse.json({ error: "Keine gültigen SEPA-Einzüge", errors }, { status: 400 });
  }

  // XML bauen
  const messageId = `AK2-${collectionDate.toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now()}`;
  const xml = buildSepaPain008Xml({
    messageId,
    creationDateTime: new Date(),
    collectionDate,
    creditorName: config.creditorName,
    creditorId: config.creditorId,
    initiatingPartyName: config.initiatingPartyName,
    creditorIban: bankAccount.iban,
    creditorBic: bankAccount.bic,
    debtors,
  });

  // Optional: Transaktionen erzeugen (als einzelne Paare)
  let createdTransactionIds: number[] = [];
  if (body?.createTransactions) {
    const description = `SEPA-Einzug ${collectionDate.toISOString().slice(0, 10)}`;
    const reference = messageId;

    createdTransactionIds = await prisma.$transaction(async (p) => {
      const ids: number[] = [];
      for (const d of debtors) {
        const u = byId.get(Number(d.userId)) as any;
        if (!u?.accountId) continue;

        // Einzug gleicht Negativsaldo aus: Nutzer +amount, Bankkonto +amount
        const { tx1, tx2 } = await createPairedTransactions(p, {
          account1Id: Number(u.accountId),
          amount1: Number(d.amount),
          account2Id: Number(bankAccount.accountId),
          amount2: Number(d.amount),
          description,
          createdById,
          reference,
          dateValued: collectionDate,
        });
        ids.push(tx1.id, tx2.id);
      }
      return ids;
    });
  }

  // Optional: Lastschriftankündigung senden
  let mailResult: { total: number; success: number; failed: number; errors: any[] } | null = null;
  if (body?.sendInfoMail) {
    try {
      const items = await prisma.user.findMany({
        where: { id: { in: debtors.map((d) => Number(d.userId)) } },
        include: { account: true },
      });
      const inputs: MailBuildInput[] = items.map((u) => ({ kind: "user", user: u as any }));

      const subject = `Lastschriftankündigung (SEPA) – Einzug am ${collectionDate.toISOString().slice(0, 10)}`;
      const remarkLines: string[] = [];
      remarkLines.push(`Es ist ein SEPA-Lastschrifteinzug für den ${collectionDate.toISOString().slice(0, 10)} angekündigt.`);
      remarkLines.push(`Verwendungszweck: ${remittanceGlobal}`);
      remarkLines.push(`Referenz: ${messageId}`);
      if (body?.remark && String(body.remark).trim()) {
        remarkLines.push("");
        remarkLines.push(String(body.remark).trim());
      }
      const remarkText = remarkLines.join("\n");

      const { success, errors } = await sendMails(inputs, remarkText, initiatorName, initiatorEmail, subject);
      mailResult = { total: inputs.length, success, failed: errors.length, errors };
    } catch (e: any) {
      mailResult = { total: 0, success: 0, failed: 1, errors: [{ to: "*", error: e?.message || String(e) }] };
    }
  }

  return NextResponse.json({
    xml,
    messageId,
    recipients: debtors.length,
    totalAmount: debtors.reduce((acc, d) => acc + Number(d.amount), 0),
    createTransactions: Boolean(body?.createTransactions),
    createdTransactionIds,
    errors,
    sendInfoMail: Boolean(body?.sendInfoMail),
    mailResult,
    remark: body?.remark?.trim() || null,
  });
}
