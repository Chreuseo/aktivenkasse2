// src/api/user/validate/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const body = await req.json();
  const { keycloak_id, first_name, last_name, mail } = body;
  if (!keycloak_id) {
    return NextResponse.json({ error: "Missing keycloak_id" }, { status: 400 });
  }

  // Cookie aus Request auslesen
  const cookieHeader = req.headers.get("cookie");
  let cookieId: string | undefined = undefined;
  if (cookieHeader) {
    const match = cookieHeader.match(/validated_user_keycloak_id=([^;]+)/);
    if (match) {
      cookieId = match[1];
    }
  }

  // Wenn Cookie vorhanden und ID stimmt überein, skippen
  if (cookieId && cookieId === keycloak_id) {
    return NextResponse.json({ success: true, skipped: true });
  }

  // Wenn Cookie vorhanden, aber ID abweicht, Cookie löschen
  let cookieDeleted = false;
  if (cookieId && cookieId !== keycloak_id) {
    cookieDeleted = true;
  }

  // User prüfen/aktualisieren/erstellen
  let user = await prisma.user.findUnique({ where: { keycloak_id } });
  if (user) {
    if (
      user.first_name !== first_name ||
      user.last_name !== last_name ||
      user.mail !== mail
    ) {
      user = await prisma.user.update({
        where: { keycloak_id },
        data: { first_name, last_name, mail },
      });
    }
  } else {
    user = await prisma.user.create({
      data: { keycloak_id, first_name, last_name, mail, account: { connect: { id: 1 } } },
    });
  }

  // Response und Cookie setzen
  const response = NextResponse.json({ success: true, user, cookie_deleted: cookieDeleted });
  if (cookieDeleted) {
    response.cookies.set("validated_user_keycloak_id", "", { path: "/", httpOnly: true, maxAge: 0 });
  }
  response.cookies.set("validated_user_keycloak_id", keycloak_id, { path: "/", httpOnly: true });
  return response;
}