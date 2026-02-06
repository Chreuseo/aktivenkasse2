import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { extractUserFromAuthHeader } from "@/lib/serverUtils";
import { createTransactionWithBalance } from "@/services/transactionService";

function adjustBalanceDecimal(current: any, delta: number) {
  const cur = Number(current);
  const next = cur + delta;
  return next.toFixed(2);
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

  const { allowanceId, withhold, withholdAmount, withholdDescription, budgetPlanId, costCenterId } = body || {};
  if (!allowanceId) return NextResponse.json({ error: "allowanceId fehlt" }, { status: 400 });

  const allowance = await prisma.allowance.findUnique({ where: { id: Number(allowanceId) }, include: { account: true } });
  if (!allowance) return NextResponse.json({ error: "Rückstellung nicht gefunden" }, { status: 404 });
  if (allowance.returnDate) return NextResponse.json({ error: "Bereits erstattet" }, { status: 400 });

  const amt = Number(allowance.amount);
  const wh = withhold ? Math.abs(Number(withholdAmount || 0)) : 0;
  if (withhold && (!withholdAmount || !withholdDescription || !budgetPlanId || !costCenterId)) {
    return NextResponse.json({ error: "Einbehalt Felder fehlen" }, { status: 400 });
  }
  if (wh > amt) return NextResponse.json({ error: "Einbehalt darf nicht größer als Rückstellungsbetrag sein" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Rückstellung erstatten: Betrag voll draufrechnen
      const account = await tx.account.findUnique({ where: { id: allowance.accountId } });
      if (!account) throw new Error("Account nicht gefunden");
      const newBalance = adjustBalanceDecimal(account.balance, amt);
      await tx.account.update({ where: { id: allowance.accountId }, data: { balance: newBalance as any } });

      // Rückstellung markieren
      const updated = await tx.allowance.update({ where: { id: allowance.id }, data: { returnDate: new Date(), withheld: wh } });

      // Optional Einbehalt als Transaktion erfassen (negativ, vom Account abziehen)
      if (withhold && wh > 0) {
        // Ersteller über id oder keycloak_id ermitteln
        const creator = await tx.user.findFirst({
          where: {
            OR: [
              { id: Number(userId) || -1 },
              { keycloak_id: String(userId) },
            ],
          },
        });
        if (!creator) throw new Error("Ersteller nicht gefunden");

        const createdTx = await createTransactionWithBalance(tx, {
          accountId: allowance.accountId,
          amount: -wh,
          description: withholdDescription,
          createdById: creator.id,
          reference: `Einbehalt aus Rückstellung ${allowance.id}`,
          dateValued: new Date(),
          costCenterId: Number(costCenterId),
        });

        return { updated, transaction: createdTx };
      }

      return { updated };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Fehler bei Erstattung" }, { status: 500 });
  }
}
