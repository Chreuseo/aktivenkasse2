import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST: /api/budget-plan/cost-centers/[id]/recalculate
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });

  // Hole alle Transaktionen mit costCenterId = id
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: id },
    select: { amount: true, account1Negative: true, account2Negative: true, accountId1: true, accountId2: true },
  });

  // Einnahmen/Ausgaben berechnen
  let earnings = 0;
  let costs = 0;
  for (const t of transactions) {
    // Einnahmen: positive Beträge, die der Kostenstelle zufließen
    // Ausgaben: negative Beträge, die abfließen
    // Annahme: account1Negative = true => Ausgabe, sonst Einnahme
    if (t.account1Negative) {
      costs += Number(t.amount);
    } else {
      earnings += Number(t.amount);
    }
  }

  // Update Kostenstelle
  const cc = await prisma.costCenter.update({
    where: { id },
    data: {
      earnings_actual: earnings,
      costs_actual: costs,
    },
  });

  return NextResponse.json({ success: true, earnings_actual: earnings, costs_actual: costs });
}

