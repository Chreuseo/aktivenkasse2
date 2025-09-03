import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {checkPermission} from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

// POST: /api/budget-plan/cost-centers/[id]/recalculate
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }

  // Hole alle Transaktionen mit costCenterId = id (neues Schema, signed amounts)
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: id },
    select: { amount: true },
  });

  // Einnahmen/Ausgaben berechnen
  let earnings = 0;
  let costs = 0;
  for (const t of transactions) {
    const val = Number(t.amount);
    if (val > 0) earnings += val; else costs += Math.abs(val);
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
