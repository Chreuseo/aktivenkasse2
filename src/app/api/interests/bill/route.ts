import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { computeInterestContributions, type DueWithAccount } from "@/services/interestService";
import { createTransactionWithBalance } from "@/services/transactionService";

function parseBool(val: any): boolean | null {
  if (val == null) return null;
  const v = String(val).toLowerCase();
  if (["true", "1", "yes"].includes(v)) return true;
  if (["false", "0", "no"].includes(v)) return false;
  return null;
}

function getRate(): number {
  const s = process.env.INTEREST_RATE_PERCENT || process.env["interest.rate.percent"] || "0";
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function POST(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Nicht erlaubt" }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {}

  // Kostenstelle ist Pflicht
  const costCenterId = Number(body?.costCenterId);
  if (!Number.isFinite(costCenterId) || costCenterId <= 0) {
    return NextResponse.json({ error: "Kostenstelle (costCenterId) ist Pflicht." }, { status: 400 });
  }

  const includePaid = parseBool(body.includePaid);
  const includeUnpaid = parseBool(body.includeUnpaid ?? true); // default beide, aber unten kein Filter = beide
  const includeBilled = parseBool(body.includeBilled);
  const includeUnbilled = parseBool(body.includeUnbilled ?? true);

  const where: any = {};
  if (includePaid !== null || includeUnpaid !== null) {
    if (includePaid && includeUnpaid) {
      // kein Filter
    } else if (includePaid && !includeUnpaid) {
      where.paid = true;
    } else if (!includePaid && includeUnpaid) {
      where.paid = false;
    } else {
      where.paid = { in: [null] };
    }
  }
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

  // Optional: ids einschränken
  if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
    if (ids.length) where.id = { in: ids };
  }

  // createdBy ermitteln
  let { userId } = extractTokenAndUserId(req as any);
  let createdById: number | null = null;
  if (userId) {
    const user = isNaN(Number(userId))
      ? await prisma.user.findUnique({ where: { keycloak_id: userId } })
      : await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (user) createdById = user.id;
  }
  if (!createdById) return NextResponse.json({ error: "Kein Benutzerkontext" }, { status: 400 });

  const rateStr = process.env.INTEREST_RATE_PERCENT || process.env["interest.rate.percent"] || "0";
  const rate = parseFloat(String(rateStr).replace(",", "."));
  const today = new Date();

  // Alle betroffenen Dues laden inkl. Account (für interest-Flag)
  const dues = await prisma.dues.findMany({ where, orderBy: [{ dueDate: "asc" }, { id: "asc" }], include: { account: true } });

  // Overlap-Logik anwenden über unbilled-Dues
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

  const { perDue } = computeInterestContributions(unbilled, today, Number.isFinite(rate) ? rate : 0);

  let processed = 0;
  let txCreated = 0;
  const results: Array<{ id: number; interest: number; newDueId?: number | null; interestTxId?: number | null }> = [];

  await prisma.$transaction(async (p) => {
    for (const d of dues) {
      if (d.interestBilled) continue; // bereits abgerechnet
      const acc = (d as any).account as any;
      const interestEnabled = !!acc?.interest;

      const contrib = perDue.get(d.id) || { days: 0, interest: 0 };
      const interestAmount = interestEnabled ? contrib.interest : 0;

      let interestTxId: number | null = null;
      if (interestEnabled && interestAmount > 0) {
        const tx = await createTransactionWithBalance(p, {
          accountId: d.accountId,
          amount: -interestAmount,
          description: `Zinsen für Fälligkeit #${d.id} (${contrib.days} Tage, ${rate}% p.a.)`,
          createdById: createdById!,
          dateValued: today,
          costCenterId: costCenterId,
        });
        interestTxId = tx.id;
        txCreated += 1;
      }

      let newDueId: number | null = null;
      if (!d.paid) {
        await p.dues.update({ where: { id: d.id }, data: { paid: true, paidAt: today, interestBilled: true, transactionId: interestTxId ?? undefined } });
        const newDue = await p.dues.create({ data: { accountId: d.accountId, amount: d.amount as any, dueDate: today } });
        newDueId = newDue.id;
      } else {
        await p.dues.update({ where: { id: d.id }, data: { interestBilled: true, transactionId: interestTxId ?? undefined } });
      }

      processed += 1;
      results.push({ id: d.id, interest: interestAmount, newDueId, interestTxId });
    }
  });

  return NextResponse.json({ processed, txCreated, results });
}
