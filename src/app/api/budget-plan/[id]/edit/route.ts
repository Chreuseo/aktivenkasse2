import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function PUT(req: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  // Berechtigungsprüfung: write_all für budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, description, state } = data;
  if (!name || !state) return NextResponse.json({ error: "Name und Status sind erforderlich" }, { status: 400 });
  try {
    await prisma.budgetPlan.update({
      where: { id: idNum },
      data: {
        name,
        description: description ?? null,
        state,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Fehler beim Aktualisieren", detail: error?.message }, { status: 500 });
  }
}

