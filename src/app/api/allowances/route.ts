import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { extractUserFromAuthHeader } from "@/lib/serverUtils";

function adjustBalanceDecimal(current: any, delta: number) {
  const cur = Number(current);
  const next = cur + delta;
  return next.toFixed(2);
}

function resolveAccountId(type: string, id: number) {
  return prisma.account.findFirst({
    where: type === "user"
      ? { users: { some: { id } } }
      : type === "bank"
      ? { bankAccounts: { some: { id } } }
      : type === "clearing_account"
      ? { clearingAccounts: { some: { id } } }
      : { id: -1 },
    select: { id: true },
  });
}

export async function GET(req: NextRequest) {
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") || "open"; // open | returned | all

  const where: any = {};
  if (filter === "open") where.returnDate = null;
  if (filter === "returned") where.returnDate = { not: null };

  const list = await prisma.allowance.findMany({
    where,
    orderBy: { date: "desc" },
    include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } },
  });

  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) return NextResponse.json({ error: "Keine UserId im Token" }, { status: 403 });

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || "Forbidden" }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });
  }

  const { type, accountId, description, amount } = body || {};
  if (!type || !accountId || !amount) {
    return NextResponse.json({ error: "Pflichtfelder fehlen", detail: "type, accountId, amount" }, { status: 400 });
  }

  const accRow = await resolveAccountId(String(type), Number(accountId));
  if (!accRow) return NextResponse.json({ error: "Account nicht gefunden" }, { status: 404 });

  const amt = Math.abs(Number(amount));

  try {
    const allowance = await prisma.$transaction(async (tx) => {
      const created = await tx.allowance.create({
        data: {
          description: description || null,
          amount: amt,
          accountId: accRow.id,
        },
      });
      // Betrag abziehen vom Konto
      const account = await tx.account.findUnique({ where: { id: accRow.id } });
      if (!account) throw new Error("Account nicht gefunden");
      const newBalance = adjustBalanceDecimal(account.balance, -amt);
      await tx.account.update({ where: { id: accRow.id }, data: { balance: newBalance as any } });
      return created;
    });

    return NextResponse.json(allowance, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Fehler beim Anlegen" }, { status: 500 });
  }
}
