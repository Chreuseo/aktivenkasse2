import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function PUT(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  const body = await req.json();
  try {
    const updated = await prisma.budgetPlan.update({
      where: { id: idNum },
      data: { name: body.name, description: body.description, state: body.state },
    });
    return NextResponse.json({ success: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
