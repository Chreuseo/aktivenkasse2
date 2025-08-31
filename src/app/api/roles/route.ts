import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function resolveEnv(...keys: string[]) {
  for (const k of keys) {
    if (typeof process.env[k] === "string" && process.env[k]!.length > 0) return process.env[k]!;
  }
  return undefined;
}
function normalizeBaseUrl(base: string) {
  return base.replace(/\/+$/, "");
}

async function getKeycloakToken() {
  const baseRaw = resolveEnv(
    "KEYCLOAK_BASE_URL",
    "KEYCLOAK_BASEURL",
    "KEYCLOAK_URL",
    "KEYCLOAK_HOST",
    "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
  );
  const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
  const clientId = resolveEnv("KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID");
  const clientSecret = resolveEnv("KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET_KEY");

  const missing: string[] = [];
  if (!baseRaw) missing.push("KEYCLOAK_BASE_URL");
  if (!realm) missing.push("KEYCLOAK_REALM");
  if (!clientId) missing.push("KEYCLOAK_CLIENT_ID");
  if (!clientSecret) missing.push("KEYCLOAK_CLIENT_SECRET");
  if (missing.length) throw new Error("Missing Keycloak env: " + missing.join(", "));

  const base = normalizeBaseUrl(baseRaw!);
  const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId!);
  params.append("client_secret", clientSecret!);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Keycloak token error: ${res.status} ${txt}`);
  }
  const json = await res.json();
  if (!json?.access_token) throw new Error("No access_token");
  return json.access_token as string;
}

async function fetchKeycloakRoles(token: string) {
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
  const res = await fetch(`${base}/admin/realms/${realm}/roles`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Keycloak roles fetch failed: ${res.status} ${txt}`);
  }
  const roles = await res.json();
  // Filter nach Präfix
  return Array.isArray(roles)
    ? roles.filter((r: any) => typeof r.name === 'string' && r.name.startsWith('aktivenkasse_'))
        .map((r: any) => ({ id: r.id, name: r.name }))
    : [];
}

async function createKeycloakRole(token: string, name: string) {
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

  // Präfix hinzufügen, falls nicht vorhanden
  const roleName = name.startsWith('aktivenkasse_') ? name : `aktivenkasse_${name}`;

  // versuche erstellen
  const createRes = await fetch(`${base}/admin/realms/${realm}/roles`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: roleName }),
  });

  if (createRes.status !== 201 && createRes.status !== 409) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Keycloak create role failed: ${createRes.status} ${txt}`);
  }

  // hole die Role nach Namen (sowohl neu als auch vorhanden)
  const getRes = await fetch(`${base}/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) {
    const txt = await getRes.text().catch(() => "");
    throw new Error(`Keycloak get role failed: ${getRes.status} ${txt}`);
  }
  const role = await getRes.json();
  return { id: role.id, name: role.name };
}

export async function GET() {
  try {
    const token = await getKeycloakToken();
    const kcRoles = await fetchKeycloakRoles(token);
    const kcIds = kcRoles.map(r => r.id);

    // ensure roles from keycloak exist in DB (create with default enums = 'none')
    for (const kr of kcRoles) {
      const exists = await prisma.role.findUnique({ where: { keycloak_id: kr.id } });
      if (!exists) {
        await prisma.role.create({
          data: {
            name: kr.name,
            keycloak_id: kr.id,
            household: "none",
            userAuth: "none",
            help_accounts: "none",
            bank_accounts: "none",
            transactions: "none",
            advances: "none",
          },
        });
      }
    }

    // return all roles from DB
    const dbRoles = await prisma.role.findMany();
    return NextResponse.json(dbRoles);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Laden der Rollen", detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name: string = (body?.name || "").trim();
    const userId: number | undefined = body?.userId;
    // Nutzerrolle: name beginnt mit user_ und userId ist gesetzt
    if (name.startsWith("user_") && userId) {
      // Prüfe, ob Nutzer existiert
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
      // Rolle lokal anlegen, falls noch nicht vorhanden
      const existing = await prisma.role.findFirst({ where: { name, userId } });
      if (existing) return NextResponse.json(existing, { status: 200 });
      const created = await prisma.role.create({
        data: {
          name,
          userId,
          household: "none",
          userAuth: "none",
          help_accounts: "none",
          bank_accounts: "none",
          transactions: "none",
          advances: "none",
        },
      });
      return NextResponse.json(created, { status: 201 });
    }

    const token = await getKeycloakToken();
    const kc = await createKeycloakRole(token, name);

    // create DB entry if missing
    const existing = await prisma.role.findUnique({ where: { keycloak_id: kc.id } });
    if (existing) return NextResponse.json(existing, { status: 200 });

    const created = await prisma.role.create({
      data: {
        name: kc.name,
        keycloak_id: kc.id,
        household: "none",
        userAuth: "none",
        help_accounts: "none",
        bank_accounts: "none",
        transactions: "none",
        advances: "none",
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Anlegen der Rolle", detail: err?.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!id) return NextResponse.json({ error: "ID fehlt" }, { status: 400 });

    const allowed: Record<string, true> = {
      household: true,
      userAuth: true,
      help_accounts: true,
      bank_accounts: true,
      transactions: true,
      advances: true,
      name: true,
    };

    const data: any = {};
    for (const k of Object.keys(body)) {
      if (allowed[k]) data[k] = body[k];
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Keine updatable Felder" }, { status: 400 });

    const updated = await prisma.role.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Aktualisieren", detail: err?.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!id) return NextResponse.json({ error: "ID fehlt" }, { status: 400 });

    // Hole die Rolle
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return NextResponse.json({ error: "Rolle nicht gefunden" }, { status: 404 });

    // Lösche ggf. in Keycloak
    if (role.keycloak_id) {
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
        if (baseRaw && realm) {
          const base = normalizeBaseUrl(baseRaw);
          await fetch(`${base}/admin/realms/${realm}/roles/${encodeURIComponent(role.name ?? "")}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (e) {
        // Fehler bei Keycloak-Löschung ignorieren, aber loggen
        console.error("Keycloak-Löschung fehlgeschlagen:", e);
      }
    }

    // Lösche aus DB
    await prisma.role.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Löschen", detail: err?.message }, { status: 500 });
  }
}
