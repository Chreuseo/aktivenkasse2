import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET: /api/budget-plan/cost-centers?planId=123
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");
  if (!planId) return NextResponse.json([], { status: 400 });
  const costCenters = await prisma.costCenter.findMany({
    where: { budget_planId: Number(planId) },
    select: {
      id: true,
      name: true,
      description: true,
      earnings_expected: true,
      costs_expected: true,
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
