import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

// POST: /api/budget-plan/[id]/finalize
// Führt eine abschließende Neuberechnung durch und setzt den Plan-Status auf "closed".
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const planId = Number(id);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  // Permission: write_all on budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }

  const plan = await prisma.budgetPlan.findUnique({ where: { id: planId }, select: { id: true, state: true } });
  if (!plan) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  }
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist bereits geschlossen" }, { status: 409 });
  }

  const costCenters = await prisma.costCenter.findMany({
    where: { budget_planId: planId },
    select: { id: true },
  });

  // Transaktion: neu berechnen und Status schließen
  const results: Array<{ id: number; earnings_actual: number; costs_actual: number }> = [];
  await prisma.$transaction(async (tx) => {
    const ccIds = costCenters.map((c) => c.id);
    if (ccIds.length) {
      const transactions = await tx.transaction.findMany({
        where: { costCenterId: { in: ccIds } },
        select: { costCenterId: true, amount: true },
      });

      for (const cc of costCenters) {
        let earnings = 0;
        let costs = 0;
        for (const t of transactions) {
          if (t.costCenterId !== cc.id) continue;
          const val = Number(t.amount);
          if (val < 0) {
            earnings += Math.abs(val);
          } else if (val > 0) {
            costs += val;
          }
        }
        await tx.costCenter.update({ where: { id: cc.id }, data: { earnings_actual: earnings, costs_actual: costs } });
        results.push({ id: cc.id, earnings_actual: earnings, costs_actual: costs });
      }
    }
    // Plan schließen
    await tx.budgetPlan.update({ where: { id: planId }, data: { state: "closed" } });
  });

  return NextResponse.json({ success: true, closed: true, updated: results });
}

