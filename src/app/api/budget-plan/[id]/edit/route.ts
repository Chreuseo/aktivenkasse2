import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const idNum = Number(id);
  if (isNaN(idNum)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  // Berechtigungsprüfung: write_all für budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf budget_plan" }, { status: 403 });
  }
  // Plan laden und auf Status prüfen
  const existing = await prisma.budgetPlan.findUnique({ where: { id: idNum }, select: { state: true } });
  if (!existing) {
    return NextResponse.json({ error: "BudgetPlan nicht gefunden" }, { status: 404 });
  }
  if (existing.state === "closed") {
    return NextResponse.json({ error: "BudgetPlan ist geschlossen und kann nicht bearbeitet werden" }, { status: 409 });
  }
  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const { name, description, state } = data;
  if (!name || !state) return NextResponse.json({ error: "Name und Status sind erforderlich" }, { status: 400 });
  // Setzen auf 'closed' ist hier nicht erlaubt – erfolgt über Finalisierung
  if (state === "closed") {
    return NextResponse.json({ error: "Status 'closed' kann nicht über diese Route gesetzt werden (Finalisierung verwenden)." }, { status: 400 });
  }
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
