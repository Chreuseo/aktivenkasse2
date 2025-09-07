import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {checkPermission} from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

// POST: /api/budget-plan/cost-centers/[id]/recalculate
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }

  // Hole alle Transaktionen mit costCenterId = id (signed amounts)
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: id },
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
    where: { id },
    data: {
      earnings_actual: earnings,
      costs_actual: costs,
    },
  });

  return NextResponse.json({ success: true, earnings_actual: earnings, costs_actual: costs });
}
