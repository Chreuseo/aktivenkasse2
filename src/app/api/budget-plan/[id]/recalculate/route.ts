import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function POST(req: NextRequest, context: any) {
  const { id } = context.params;
  const idNum = Number(id);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  try {
    const costCenters = await prisma.costCenter.findMany({ where: { budget_planId: idNum } });
    for (const cc of costCenters) {
      const txs = await prisma.transaction.findMany({ where: { costCenterId: cc.id } });
      let earnings = 0, costs = 0;
      for (const t of txs) {
        const val = Number(t.amount);
        if (val > 0) earnings += val; else if (val < 0) costs += Math.abs(val);
      }
      await prisma.costCenter.update({ where: { id: cc.id }, data: { earnings_actual: earnings, costs_actual: costs } });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
