import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: NextRequest, context: any) {
  const id = context?.params?.id as string;
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  // Berechtigungsprüfung: read_all für budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf budget_plan" }, { status: 403 });
  }
  const plan = await prisma.budgetPlan.findUnique({ where: { id: idNum } });
  if (!plan) return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  return NextResponse.json({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    state: plan.state,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    firstCostCenter: plan.firstCostCenter,
  });
}

export async function PATCH(req: NextRequest, context: any) {
  const id = context?.params?.id as string;
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  // Berechtigungsprüfung: write_all für budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Bestehenden Plan laden und auf Status prüfen
  const existing = await prisma.budgetPlan.findUnique({ where: { id: idNum }, select: { id: true, state: true } });
  if (!existing) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  }
  if (existing.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }
  const body = await req.json();
  try {
    const updated = await prisma.budgetPlan.update({
      where: { id: idNum },
      data: {
        name: body.name,
        description: body.description,
        state: body.state,
        updatedAt: body.updatedAt ? new Date(body.updatedAt) : undefined,
        firstCostCenter: body.firstCostCenter ?? undefined,
      },
    });
    return NextResponse.json({ success: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
