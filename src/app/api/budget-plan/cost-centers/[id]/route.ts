import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT: /api/budget-plan/cost-centers/:id
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const data = await req.json();
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
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

// DELETE: /api/budget-plan/cost-centers/:id
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "ID erforderlich" }, { status: 400 });
  await prisma.costCenter.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
