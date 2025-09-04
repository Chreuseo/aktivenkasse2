import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission} from "@/services/authService";


// GET: /api/budget-plan/cost-centers?planId=123
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");
  if (!planId) return NextResponse.json([], { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.read_all)
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf budget_plan" }, { status: 403 });
  }

  // Sicherstellen, dass nur aktive Pläne abrufbar sind
  const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(planId) }, select: { id: true, state: true } });
  if (!plan) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  }
  if (plan.state !== "active") {
    return NextResponse.json({ error: "BudgetPlan ist nicht aktiv" }, { status: 409 });
  }

  const costCenters = await prisma.costCenter.findMany({
    where: { budget_planId: Number(planId) },
    select: {
      id: true,
      name: true,
      description: true,
      earnings_expected: true,
      costs_expected: true,
      earnings_actual: true,
      costs_actual: true,
      nextCostCenter: true,
    },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(costCenters);
}

// POST: /api/budget-plan/cost-centers
export async function POST(req: NextRequest) {
  const data = await req.json();
  if (!data.name || !data.budget_planId) return NextResponse.json({ error: "Name und budget_planId erforderlich" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all)
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Planstatus prüfen
  const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(data.budget_planId) }, select: { state: true } });
  if (!plan) return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  if (plan.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }
  const cc = await prisma.costCenter.create({
    data: {
      name: data.name,
      description: data.description ?? "",
      earnings_expected: data.earnings_expected ?? 0,
      costs_expected: data.costs_expected ?? 0,
      budget_planId: data.budget_planId,
    },
  });
  return NextResponse.json(cc);
}
