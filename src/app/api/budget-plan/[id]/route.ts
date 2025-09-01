import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request, context: { params: { id: string } }) {
  const { id } = context.params;
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
    updatedAt: plan.updatedAt
  });
}

