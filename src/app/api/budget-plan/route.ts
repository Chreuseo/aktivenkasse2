import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  // Berechtigungsprüfung: read_all für budget_plan
  const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf budget_plan" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const state = url.searchParams.get("state");

    const where: any = {};
    if (state) {
      // nur validen Zustand akzeptieren
      const allowed = ["draft", "active", "closed"];
      if (!allowed.includes(state)) {
        return NextResponse.json({ error: "Ungültiger state" }, { status: 400 });
      }
      where.state = state as any;
    }

    const plans = await prisma.budgetPlan.findMany({ where });
    // Nur relevante Felder zurückgeben
    const result = plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      state: plan.state
    }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Laden der Haushaltspläne", detail: error?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

  const { name, description } = data;
  if (!name) {
    return NextResponse.json({ error: "Name ist ein Pflichtfeld" }, { status: 400 });
  }

  try {
    const budgetPlan = await prisma.budgetPlan.create({
      data: {
        name,
        description: description || null,
      }
    });
    return NextResponse.json({
      id: budgetPlan.id,
      name: budgetPlan.name,
      description: budgetPlan.description,
      createdAt: budgetPlan.createdAt,
      updatedAt: budgetPlan.updatedAt,
      state: budgetPlan.state
    }, { status: 201 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Anlegen des Haushaltsplans", detail: error?.message }, { status: 500 });
  }
}
