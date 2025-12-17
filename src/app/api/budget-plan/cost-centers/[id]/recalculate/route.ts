import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

// POST: /api/budget-plan/cost-centers/[id]/recalculate
export async function POST(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });

  // Hole alle Transaktionen mit costCenterId = id (signed amounts)
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: idNum },
    select: { amount: true },
  });

  // Einnahmen/Ausgaben berechnen (Sicht der Kasse: negativ = Einnahmen, positiv = Ausgaben)
  let earnings = 0;
  let costs = 0;
  for (const t of transactions) {
    const val = Number(t.amount);
    if (val < 0) {
      earnings += Math.abs(val);
    } else if (val > 0) {
      costs += val;
    }
  }

  // Update Kostenstelle
  await prisma.costCenter.update({
    where: { id: idNum },
    data: {
      earnings_actual: earnings,
      costs_actual: costs,
    },
  });

  return NextResponse.json({ success: true, id: idNum, earnings_actual: earnings, costs_actual: costs });
}
