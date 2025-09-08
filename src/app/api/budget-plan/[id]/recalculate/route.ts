import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

// POST: /api/budget-plan/[id]/recalculate
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

  // Prüfen, ob Plan existiert und nicht geschlossen ist
  const plan = await prisma.budgetPlan.findUnique({ where: { id: planId }, select: { id: true, state: true } });
  if (!plan) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  }
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }

  // Kostenstellen des Plans laden
  const costCenters = await prisma.costCenter.findMany({
    where: { budget_planId: planId },
    select: { id: true },
  });
  if (costCenters.length === 0) {
    return NextResponse.json({ success: true, updated: [] });
  }

  const ccIds = costCenters.map(c => c.id);
  // Alle relevanten Transaktionen inkl. Kontotyp laden
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: { in: ccIds } },
    select: { costCenterId: true, amount: true, account: { select: { type: true } } },
  });

  const results: Array<{ id: number; earnings_actual: number; costs_actual: number }> = [];

  // Transaktionale Aktualisierung
  await prisma.$transaction(async (tx) => {
    for (const cc of costCenters) {
      let earnings = 0; // Einnahmen (positiv)
      let costs = 0;    // Ausgaben (positiv)
      for (const t of transactions) {
        if (t.costCenterId !== cc.id) continue;
        const val = Number(t.amount);
        const accType = t.account.type; // 'user' | 'bank' | 'clearing_account'
        if (accType === 'bank') {
          // Bankkonto: Positiv -> Einnahmen, Negativ -> Ausgaben
          if (val > 0) earnings += val; else if (val < 0) costs += Math.abs(val);
        } else {
          // Nutzer/Verrechnung: Positiv -> Ausgaben, Negativ -> Einnahmen
          if (val > 0) costs += val; else if (val < 0) earnings += Math.abs(val);
        }
      }
      await tx.costCenter.update({
        where: { id: cc.id },
        data: { earnings_actual: earnings, costs_actual: costs },
      });
      results.push({ id: cc.id, earnings_actual: earnings, costs_actual: costs });
    }
  });

  return NextResponse.json({ success: true, updated: results });
}
