import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission} from "@/services/authService";


// PUT: /api/budget-plan/cost-centers/:id
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const data = await req.json();
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });

  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all)
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
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
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
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
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
  await prisma.costCenter.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
