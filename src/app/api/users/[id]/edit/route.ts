import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";

async function getIdFromContext(context: { params: Promise<{ id: string }> | { id: string } }): Promise<string> {
  const p: any = (context as any).params;
  if (p && typeof p.then === "function") {
    const { id } = await p;
    return id;
  }
  return (p?.id ?? "");
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> | { id: string } }) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Nutzer bearbeiten" }, { status: 403 });
  }
  const idStr = await getIdFromContext(context);
  const idNum = Number(idStr);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige Nutzer-ID" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: idNum } });
  if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
  return NextResponse.json({
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    mail: user.mail,
    enabled: user.enabled,
  });
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> | { id: string } }) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Nutzer bearbeiten" }, { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }
  const idStr = await getIdFromContext(context);
  const idNum = Number(idStr);
  if (!idNum || isNaN(idNum)) return NextResponse.json({ error: "Ungültige Nutzer-ID" }, { status: 400 });
  const { first_name, last_name, mail, enabled } = body || {};
  if (!first_name || !last_name || !mail || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Vorname, Nachname, Mail und Enabled sind erforderlich" }, { status: 400 });
  }
  // Nutzer laden (Keycloak-ID erforderlich)
  const user = await prisma.user.findUnique({ where: { id: idNum } });
  if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });

  // Validierung vor Deaktivierung: nur erlaubt, wenn Kontostand 0 und keine Clearing-Account-Mitgliedschaft
  if (user.enabled && enabled === false) {
    // Kontostand prüfen
    const acc = await prisma.account.findUnique({ where: { id: user.accountId }, select: { balance: true } });
    const balanceZero = acc ? Number(acc.balance) === 0 : false;
    if (!balanceZero) {
      return NextResponse.json({ error: "Deaktivierung nicht möglich: Kontostand ist nicht 0." }, { status: 400 });
    }
    // Mitgliedschaften prüfen
    const membership = await prisma.clearingAccountMember.findFirst({ where: { userId: user.id } });
    if (membership) {
      return NextResponse.json({ error: "Deaktivierung nicht möglich: Nutzer ist Mitglied eines Verrechnungskontos." }, { status: 400 });
    }
  }

  // 1) Keycloak aktualisieren (nur Namen + Mail)
  try {
    const token = await getKeycloakToken();
    const baseRaw = resolveEnv(
      "KEYCLOAK_BASE_URL",
      "KEYCLOAK_BASEURL",
      "KEYCLOAK_URL",
      "KEYCLOAK_HOST",
      "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
    );
    const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
    if (!baseRaw || !realm) throw new Error("Missing KEYCLOAK_BASE_URL or KEYCLOAK_REALM");
    const base = normalizeBaseUrl(baseRaw);

    const kcId = user.keycloak_id;
    const getRes = await fetch(`${base}/admin/realms/${realm}/users/${kcId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!getRes.ok) {
      const txt = await getRes.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-User nicht gefunden: ${getRes.status} ${txt}` }, { status: 502 });
    }
    const current = await getRes.json();
    const payload = {
      ...current,
      firstName: first_name,
      lastName: last_name,
      email: mail,
    };
    const putRes = await fetch(`${base}/admin/realms/${realm}/users/${kcId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-Update fehlgeschlagen: ${putRes.status} ${txt}` }, { status: 502 });
    }
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Fehler beim Update in Keycloak", detail: e?.message }, { status: 500 });
  }

  // 2) DB aktualisieren (inkl. enabled)
  await prisma.user.update({
    where: { id: idNum },
    data: { first_name, last_name, mail, enabled },
  });

  return NextResponse.json({ success: true });
}
