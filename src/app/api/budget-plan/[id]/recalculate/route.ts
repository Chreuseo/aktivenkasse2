import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

// POST: /api/budget-plan/[id]/recalculate
export async function POST(req: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const planId = Number(id);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  // Permission: write_all on budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }

  // Prüfen, ob Plan existiert
  const plan = await prisma.budgetPlan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
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
  // Alle relevanten Transaktionen in einem Schwung laden
  const transactions = await prisma.transaction.findMany({
    where: { costCenterId: { in: ccIds } },
    select: { costCenterId: true, amount: true },
  });

  const updates: Promise<unknown>[] = [];
  const results: Array<{ id: number; earnings_actual: number; costs_actual: number }> = [];

  // Äußere Schleife: Kostenstellen; Innere Schleife: Transaktionen
  for (const cc of costCenters) {
    let earnings = 0; // Einnahmen (positiver Betrag, absolut)
    let costs = 0; // Ausgaben (positiver Betrag, absolut)
    for (const t of transactions) {
      if (t.costCenterId !== cc.id) continue;
      const val = Number(t.amount);
      // Aus Sicht der Kasse: negative Beträge sind Einnahmen, positive Ausgaben
      if (val < 0) {
        earnings += Math.abs(val);
      } else if (val > 0) {
        costs += val;
      }
    }
    updates.push(prisma.costCenter.update({
      where: { id: cc.id },
      data: { earnings_actual: earnings, costs_actual: costs },
    }));
    results.push({ id: cc.id, earnings_actual: earnings, costs_actual: costs });
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return NextResponse.json({ success: true, updated: results });
}
