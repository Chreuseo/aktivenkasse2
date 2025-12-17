import {NextRequest, NextResponse} from "next/server";
import prisma from "@/lib/prisma";
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission} from "@/services/authService";


// PUT: /api/budget-plan/cost-centers/:id
export async function PUT(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const body = await req.json();
  const updated = await prisma.costCenter.update({ where: { id: idNum }, data: { name: body.name } });
  return NextResponse.json({ success: true, updated });
}

// PATCH: /api/budget-plan/cost-centers/:id
export async function PATCH(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const body = await req.json();
  const updated = await prisma.costCenter.update({ where: { id: idNum }, data: body });
  return NextResponse.json({ success: true, updated });
}

// DELETE: /api/budget-plan/cost-centers/:id
export async function DELETE(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  await prisma.costCenter.delete({ where: { id: idNum } });
  return NextResponse.json({ success: true });
}
