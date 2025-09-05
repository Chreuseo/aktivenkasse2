import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

async function kcBaseAndRealm() {
  const baseRaw = resolveEnv(
    "KEYCLOAK_BASE_URL",
    "KEYCLOAK_BASEURL",
    "KEYCLOAK_URL",
    "KEYCLOAK_HOST",
    "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
  );
  const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
  if (!baseRaw || !realm) throw new Error("Missing KEYCLOAK_BASE_URL or KEYCLOAK_REALM");
  return { base: normalizeBaseUrl(baseRaw), realm };
}

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const url = new URL(req.url);
  const roleIdParam = url.searchParams.get("roleId");
  const roleId = roleIdParam ? Number(roleIdParam) : 0;
  if (!roleId) return NextResponse.json({ error: "roleId fehlt" }, { status: 400 });
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || !role.keycloak_id || !role.name) {
    return NextResponse.json({ error: "Rolle nicht in Keycloak verknüpft" }, { status: 404 });
  }
  try {
    const token = await getKeycloakToken();
    const { base, realm } = await kcBaseAndRealm();
    const res = await fetch(`${base}/admin/realms/${realm}/roles/${encodeURIComponent(role.name)}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-Fehler: ${res.status}`, detail: txt }, { status: 502 });
    }
    const arr = await res.json();
    const members: Array<{ id: string; username?: string; email?: string; firstName?: string; lastName?: string; localUserId?: number; }> = Array.isArray(arr) ? arr : [];
    const ids = members.map(m => m.id).filter(Boolean);
    const localUsers = ids.length ? await prisma.user.findMany({ where: { keycloak_id: { in: ids as string[] } } }) : [];
    const localMap = new Map(localUsers.map(u => [u.keycloak_id, u]));
    const enriched = members.map(m => ({
      id: m.id,
      username: (m as any).username,
      email: (m as any).email,
      firstName: (m as any).firstName,
      lastName: (m as any).lastName,
      localUserId: localMap.get(m.id)?.id,
    }));
    return NextResponse.json({ members: enriched });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Laden der Mitglieder", detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  try {
    const body = await req.json();
    const roleId = Number(body?.roleId || 0);
    const userId = Number(body?.userId || 0);
    if (!roleId || !userId) return NextResponse.json({ error: "roleId und userId erforderlich" }, { status: 400 });
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || !role.keycloak_id || !role.name) return NextResponse.json({ error: "Rolle nicht in Keycloak verknüpft" }, { status: 404 });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    const token = await getKeycloakToken();
    const { base, realm } = await kcBaseAndRealm();
    const kcUrl = `${base}/admin/realms/${realm}/users/${encodeURIComponent(user.keycloak_id)}/role-mappings/realm`;
    const payload = [{ id: role.keycloak_id, name: role.name }];
    const res = await fetch(kcUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!(res.status === 204 || res.status === 201)) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-Fehler: ${res.status}`, detail: txt }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Hinzufügen", detail: err?.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  try {
    const body = await req.json();
    const roleId = Number(body?.roleId || 0);
    const userId = body?.userId ? Number(body.userId) : 0;
    const userKeycloakId = body?.userKeycloakId as string | undefined;
    if (!roleId || (!userId && !userKeycloakId)) return NextResponse.json({ error: "roleId und userId|userKeycloakId erforderlich" }, { status: 400 });
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || !role.keycloak_id || !role.name) return NextResponse.json({ error: "Rolle nicht in Keycloak verknüpft" }, { status: 404 });
    let kcUserId: string | null = null;
    if (userKeycloakId) kcUserId = userKeycloakId;
    else if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
      kcUserId = user.keycloak_id;
    }
    if (!kcUserId) return NextResponse.json({ error: "Keycloak-User nicht ermittelbar" }, { status: 400 });
    const token = await getKeycloakToken();
    const { base, realm } = await kcBaseAndRealm();
    const kcUrl = `${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/role-mappings/realm`;
    const payload = [{ id: role.keycloak_id, name: role.name }];
    const res = await fetch(kcUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!(res.status === 204 || res.status === 200)) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-Fehler: ${res.status}`, detail: txt }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Entfernen", detail: err?.message }, { status: 500 });
  }
}

