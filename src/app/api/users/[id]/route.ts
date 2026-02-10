import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

type IdRouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: IdRouteContext) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      account: true,
    },
  });
  if (!user) return NextResponse.json({ error: "User nicht gefunden" }, { status: 404 });

  const accountId = user.accountId || (user as any).account?.id;

  const [transactionsAll, allowances] = await Promise.all([
    accountId
      ? prisma.transaction.findMany({
          where: { accountId },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
    accountId
      ? prisma.allowance.findMany({
          where: { accountId },
          orderBy: { date: "desc" },
          include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } },
        })
      : Promise.resolve([]),
  ]);

  const mapTx = (tx: any) => ({
    id: tx.id,
    amount: Number(tx.amount),
    date: (tx.date_valued ?? tx.date).toISOString(),
    description: tx.description,
    reference: tx.reference || undefined,
    processed: !!tx.processed,
    attachmentId: tx.attachmentId || undefined,
    receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
  });

  const planned = transactionsAll.filter(t => !t.processed).map(mapTx);
  const past = transactionsAll.filter(t => t.processed).map(mapTx);

  return NextResponse.json({
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      mail: user.mail,
      balance: user.account ? Number((user as any).account.balance) : 0,
      accountId: accountId || null,
      // SEPA Mandat
      sepa_mandate: Boolean((user as any).sepa_mandate),
      sepa_mandate_date: (user as any).sepa_mandate_date ? (user as any).sepa_mandate_date.toISOString() : null,
      sepa_mandate_reference: (user as any).sepa_mandate_reference ?? null,
      sepa_iban: (user as any).sepa_iban ?? null,
      sepa_bic: (user as any).sepa_bic ?? null,
    },
    planned,
    past,
    allowances,
  });
}

function normalizeStringOrNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeBoolean(v: any, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "ja", "on"].includes(s)) return true;
    if (["false", "0", "no", "nein", "off"].includes(s)) return false;
  }
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function normalizeDateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function PATCH(req: NextRequest, ctx: IdRouteContext) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }

  // Nur SEPA-Felder sind hier editierbar (minimaler Scope)
  const sepa_mandate = normalizeBoolean(body?.sepa_mandate, false);
  const sepa_mandate_date = normalizeDateOrNull(body?.sepa_mandate_date);
  const sepa_mandate_reference = normalizeStringOrNull(body?.sepa_mandate_reference);
  const sepa_iban = normalizeStringOrNull(body?.sepa_iban);
  const sepa_bic = normalizeStringOrNull(body?.sepa_bic);

  if (sepa_mandate) {
    const missing: string[] = [];
    if (!sepa_mandate_date) missing.push("sepa_mandate_date");
    if (!sepa_mandate_reference) missing.push("sepa_mandate_reference");
    if (!sepa_iban) missing.push("sepa_iban");
    if (missing.length) {
      return NextResponse.json({ error: "SEPA-Mandat aktiv: Pflichtfelder fehlen", missing }, { status: 400 });
    }
  }

  try {
    const updated = await (prisma.user.update as any)({
      where: { id },
      data: {
        sepa_mandate,
        sepa_mandate_date: sepa_mandate ? sepa_mandate_date : null,
        sepa_mandate_reference: sepa_mandate ? sepa_mandate_reference : null,
        sepa_iban: sepa_mandate ? sepa_iban : null,
        sepa_bic: sepa_mandate ? sepa_bic : null,
      },
      select: {
        id: true,
        sepa_mandate: true,
        sepa_mandate_date: true,
        sepa_mandate_reference: true,
        sepa_iban: true,
        sepa_bic: true,
      },
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        sepa_mandate: Boolean((updated as any).sepa_mandate),
        sepa_mandate_date: (updated as any).sepa_mandate_date ? (updated as any).sepa_mandate_date.toISOString() : null,
        sepa_mandate_reference: (updated as any).sepa_mandate_reference ?? null,
        sepa_iban: (updated as any).sepa_iban ?? null,
        sepa_bic: (updated as any).sepa_bic ?? null,
      },
    });
  } catch (e: any) {
    console.error("PATCH /api/users/[id] failed", e);
    return NextResponse.json({ error: "Fehler beim Speichern", detail: e?.message }, { status: 500 });
  }
}
