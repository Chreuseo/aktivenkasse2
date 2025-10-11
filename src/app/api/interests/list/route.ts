import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { computeInterestContributions, type DueWithAccount } from "@/services/interestService";

function parseBool(val: string | null | undefined): boolean | null {
  if (val == null) return null;
  const v = String(val).toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function getRate(): number {
  const s = process.env.INTEREST_RATE_PERCENT || process.env["interest.rate.percent"] || "0";
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildAccountLabel(acc: any): string {
  if (!acc) return String("");
  // Präferenz: User, dann Clearing, dann Bank
  if (Array.isArray(acc.users) && acc.users.length > 0) {
    const u = acc.users[0];
    return `${u.first_name} ${u.last_name}`;
  }
  if (Array.isArray(acc.clearingAccounts) && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return c?.name || "Verrechnungskonto";
  }
  if (Array.isArray(acc.bankAccounts) && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return b?.name ? `${b.name} (Bank)` : "Bankkonto";
  }
  return acc?.type || "";
}

export async function GET(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Nicht erlaubt" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  // Filter erwartet als booleans: includePaid, includeUnpaid, includeBilled, includeUnbilled
  const includePaid = parseBool(searchParams.get("includePaid"));
  const includeUnpaid = parseBool(searchParams.get("includeUnpaid"));
  const includeBilled = parseBool(searchParams.get("includeBilled"));
  const includeUnbilled = parseBool(searchParams.get("includeUnbilled"));

  const where: any = {};
  // paid-Filter
  if (includePaid !== null || includeUnpaid !== null) {
    if (includePaid && includeUnpaid) {
      // beide -> kein Filter
    } else if (includePaid && !includeUnpaid) {
      where.paid = true;
    } else if (!includePaid && includeUnpaid) {
      where.paid = false;
    } else {
      // beide false -> keine Ergebnisse
      where.paid = { in: [null] };
    }
  }
  // billed-Filter (interestBilled)
  if (includeBilled !== null || includeUnbilled !== null) {
    if (includeBilled && includeUnbilled) {
      // kein Filter
    } else if (includeBilled && !includeUnbilled) {
      where.interestBilled = true;
    } else if (!includeBilled && includeUnbilled) {
      where.interestBilled = false;
    } else {
      where.interestBilled = { in: [null] };
    }
  }

  const dues = await prisma.dues.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    include: { account: { include: { users: true, clearingAccounts: true, bankAccounts: true } } },
  });

  const rate = getRate();
  const today = new Date();

  // Beiträge nur über unbilled-Dues berechnen (Overlap-Logik pro Account)
  const unbilled: DueWithAccount[] = dues
    .filter((d) => !d.interestBilled)
    .map((d) => ({
      id: d.id,
      accountId: d.accountId,
      amount: Number(d.amount),
      dueDate: new Date(d.dueDate),
      paid: d.paid,
      paidAt: d.paidAt ? new Date(d.paidAt) : null,
      interestBilled: d.interestBilled,
      account: { interest: !!(d as any).account?.interest },
    }));

  const { perDue } = computeInterestContributions(unbilled, today, rate);

  const rows = dues.map((d) => {
    const principal = Number(d.amount);
    const acc = d.account as any;
    const c = perDue.get(d.id) || { days: 0, interest: 0 };
    return {
      id: d.id,
      accountId: d.accountId,
      accountType: acc?.type ?? null,
      accountLabel: buildAccountLabel(acc),
      interestEnabled: !!acc?.interest,
      amount: principal,
      dueDate: d.dueDate,
      paid: d.paid,
      paidAt: d.paidAt,
      interestBilled: d.interestBilled,
      days: c.days,
      interest: c.interest,
    };
  });

  return NextResponse.json({ ratePercent: rate, rows });
}
