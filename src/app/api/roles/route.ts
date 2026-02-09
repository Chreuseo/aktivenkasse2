import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";

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
  const roleName = name.startsWith('aktivenkasse_') ? name : `aktivenkasse_${name}`;
  const createRes = await fetch(`${base}/admin/realms/${realm}/roles`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: roleName }),
  });
  if (createRes.status !== 201 && createRes.status !== 409) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Keycloak create role failed: ${createRes.status} ${txt}`);
  }
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

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Rollen-Lesen" }, { status: 403 });
  }
  try {
    const token = await getKeycloakToken();
    const kcRoles = await fetchKeycloakRoles(token);
    for (const kr of kcRoles) {
      const exists = await prisma.role.findUnique({ where: { keycloak_id: kr.id } });
      if (!exists) {
        await prisma.role.create({
          data: {
            name: kr.name,
            keycloak_id: kr.id,
            overview: "none",
            mails: "none",
            budget_plan: "none",
            userAuth: "none",
            clearing_accounts: "none",
            bank_accounts: "none",
            transactions: "none",
            advances: "none",
          },
        });
      }
    }
    const dbRoles = await prisma.role.findMany();
    return NextResponse.json(dbRoles);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Laden der Rollen", detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Rollen-Anlegen" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const name: string = (body?.name || "").trim();
    const userId: number | undefined = body?.userId;
    if (name.startsWith("user_") && userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
      const existing = await prisma.role.findFirst({ where: { name, userId } });
      if (existing) return NextResponse.json(existing, { status: 200 });
      const created = await prisma.role.create({
        data: {
          name,
          userId,
          overview: "none",
          mails: "none",
          budget_plan: "none",
          userAuth: "none",
          clearing_accounts: "none",
          bank_accounts: "none",
          transactions: "none",
          advances: "none",
        },
      });
      return NextResponse.json(created, { status: 201 });
    }
    const token = await getKeycloakToken();
    const kc = await createKeycloakRole(token, name);
    const existing = await prisma.role.findUnique({ where: { keycloak_id: kc.id } });
    if (existing) return NextResponse.json(existing, { status: 200 });
    const created = await prisma.role.create({
      data: {
        name: kc.name,
        keycloak_id: kc.id,
        overview: "none",
        mails: "none",
        budget_plan: "none",
        userAuth: "none",
        clearing_accounts: "none",
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
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Rollen-Ändern" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!id) return NextResponse.json({ error: "ID fehlt" }, { status: 400 });
    const allowed: Record<string, true> = {
      overview: true,
      mails: true,
      budget_plan: true,
      userAuth: true,
      clearing_accounts: true,
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
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Rollen-Löschen" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!id) return NextResponse.json({ error: "ID fehlt" }, { status: 400 });
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return NextResponse.json({ error: "Rolle nicht gefunden" }, { status: 404 });
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
        console.error("Keycloak-Löschung fehlgeschlagen:", e);
      }
    }
    await prisma.role.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Löschen", detail: err?.message }, { status: 500 });
  }
}
