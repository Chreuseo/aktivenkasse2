import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf userAuth" }, { status: 403 });
  }
  try {
    const users = await prisma.user.findMany({
      where: { enabled: false },
      select: { id: true, first_name: true, last_name: true, mail: true },
      orderBy: [{ last_name: "asc" }, { first_name: "asc" }],
    });
    return NextResponse.json(users);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Laden der deaktivierten Nutzer", detail: error?.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf userAuth" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: "Ungültige Nutzer-ID" }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    if (user.enabled) {
      // Schon aktiv: idempotent Erfolg
      return NextResponse.json({ success: true, id });
    }
    await prisma.user.update({ where: { id }, data: { enabled: true } });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Aktivieren des Nutzers", detail: error?.message }, { status: 500 });
  }
}

