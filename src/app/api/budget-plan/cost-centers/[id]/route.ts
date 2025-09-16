import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission} from "@/services/authService";


// PUT: /api/budget-plan/cost-centers/:id
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  const data = await req.json();
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all)
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Planstatus prüfen
  const ccExisting = await prisma.costCenter.findUnique({ where: { id }, select: { budget_planId: true } });
  if (!ccExisting) return NextResponse.json({ error: "Kostenstelle nicht gefunden" }, { status: 404 });
  const plan = await prisma.budgetPlan.findUnique({ where: { id: ccExisting.budget_planId }, select: { state: true } });
  if (!plan) return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }
  const cc = await prisma.costCenter.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description ?? undefined,
      earnings_expected: data.earnings_expected ?? undefined,
      costs_expected: data.costs_expected ?? undefined,
    },
  });
  return NextResponse.json(cc);
}

// PATCH: /api/budget-plan/cost-centers/:id
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all)
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Planstatus prüfen
  const ccExisting = await prisma.costCenter.findUnique({ where: { id }, select: { budget_planId: true } });
  if (!ccExisting) return NextResponse.json({ error: "Kostenstelle nicht gefunden" }, { status: 404 });
  const plan = await prisma.budgetPlan.findUnique({ where: { id: ccExisting.budget_planId }, select: { state: true } });
  if (!plan) return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }

  const data = await req.json();
  // Erwartet: { nextCostCenter: number | null }
  const cc = await prisma.costCenter.update({
    where: { id },
    data: {
      nextCostCenter: data.nextCostCenter ?? null,
    },
  });
  return NextResponse.json(cc);
}

// DELETE: /api/budget-plan/cost-centers/:id
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all)
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Planstatus + Existenz prüfen
  const ccExisting = await prisma.costCenter.findUnique({ where: { id }, select: { budget_planId: true } });
  if (!ccExisting) return NextResponse.json({ error: "Kostenstelle nicht gefunden" }, { status: 404 });
  const plan = await prisma.budgetPlan.findUnique({ where: { id: ccExisting.budget_planId }, select: { state: true, firstCostCenter: true } });
  if (!plan) return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }
  // Blockieren falls als erste Kostenstelle eingetragen
  if (plan.firstCostCenter === id) {
    return NextResponse.json({ error: "Kostenstelle ist als erste Kostenstelle im Plan referenziert und kann nicht gelöscht werden" }, { status: 409 });
  }
  // Nutzung durch Transaktionen prüfen
  const txCount = await prisma.transaction.count({ where: { costCenterId: id } });
  if (txCount > 0) {
    return NextResponse.json({ error: `Kostenstelle hat bereits ${txCount} Buchung(en) und kann nicht gelöscht werden` }, { status: 409 });
  }
  // Prüfen ob Ist-Werte (earnings_actual / costs_actual) bereits belegt sind (Sicherheitsnetz, falls nicht über Transaktionen abgedeckt)
  const ccDetails = await prisma.costCenter.findUnique({ where: { id }, select: { earnings_actual: true, costs_actual: true } });
  if (ccDetails) {
    const earningsActual = Number(ccDetails.earnings_actual);
    const costsActual = Number(ccDetails.costs_actual);
    if (earningsActual !== 0 || costsActual !== 0) {
      return NextResponse.json({ error: "Kostenstelle weist Ist-Werte auf (earnings_actual oder costs_actual) und kann nicht gelöscht werden" }, { status: 409 });
    }
  }
  // Optional: prüfen ob andere Kostenstellen auf diese verlinken (nextCostCenter Kette)
  const referencingCount = await prisma.costCenter.count({ where: { nextCostCenter: id } });
  if (referencingCount > 0) {
    return NextResponse.json({ error: `Kostenstelle ist in einer Kette (nextCostCenter) referenziert (${referencingCount}x) und kann nicht gelöscht werden` }, { status: 409 });
  }

  await prisma.costCenter.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
