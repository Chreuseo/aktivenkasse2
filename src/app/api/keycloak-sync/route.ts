// Datei: src/app/api/keycloak-sync/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";

async function fetchAllKeycloakUsers(token: string) {
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
  const pageSize = 100;
  let first = 0;
  const out: any[] = [];
  while (true) {
    const url = `${base}/admin/realms/${realm}/users?first=${first}&max=${pageSize}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Keycloak users fetch failed: ${res.status} ${txt}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < pageSize) break;
    first += pageSize;
  }
  return out.map((u: any) => ({
    id: u.id,
    username: u.username,
    email: u.email || "",
    firstName: u.firstName || "",
    lastName: u.lastName || "",
  }));
}

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Keycloak-Sync-Lesen" }, { status: 403 });
  }
  try {
    const token = await getKeycloakToken();
    const kcUsers = await fetchAllKeycloakUsers(token);
    const ids = kcUsers.map(u => u.id);
    const dbUsers = await prisma.user.findMany({
      where: { keycloak_id: { in: ids.length ? ids : ["__none__"] } },
      select: { id: true, keycloak_id: true, mail: true, first_name: true, last_name: true },
    });
    const dbMap = new Map(dbUsers.map(u => [u.keycloak_id, u]));
    const result = kcUsers.map(u => {
      const db = dbMap.get(u.id);
      if (!db) {
        return { keycloak_id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, email: u.email, status: "new", diffs: { first_name: null, last_name: null, mail: null } };
      }
      const diffs: any = {};
      let changed = false;
      if ((db.first_name || "") !== (u.firstName || "")) { changed = true; diffs.first_name = { from: db.first_name, to: u.firstName }; } else diffs.first_name = null;
      if ((db.last_name || "") !== (u.lastName || "")) { changed = true; diffs.last_name = { from: db.last_name, to: u.lastName }; } else diffs.last_name = null;
      if ((db.mail || "") !== (u.email || "")) { changed = true; diffs.mail = { from: db.mail, to: u.email }; } else diffs.mail = null;
      return { keycloak_id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, email: u.email, status: changed ? "changed" : "same", diffs };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Lesen von Keycloak", detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Keycloak-Sync-Import" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) return NextResponse.json({ error: "Keine IDs angegeben" }, { status: 400 });
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

    const created: string[] = [];
    const updated: string[] = [];
    for (const id of ids) {
      const res = await fetch(`${base}/admin/realms/${realm}/users/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      const u = await res.json();
      const kc = { id: u.id, email: u.email || "", firstName: u.firstName || "", lastName: u.lastName || "" };
      const existing = await prisma.user.findUnique({ where: { keycloak_id: kc.id } });
      if (!existing) {
        const account = await prisma.account.create({ data: { balance: 0, interest: true, type: "user" } });
        await prisma.user.create({
          data: {
            first_name: kc.firstName,
            last_name: kc.lastName,
            mail: kc.email,
            keycloak_id: kc.id,
            accountId: account.id,
          },
        });
        created.push(kc.id);
      } else {
        await prisma.user.update({
          where: { keycloak_id: kc.id },
          data: { first_name: kc.firstName, last_name: kc.lastName, mail: kc.email },
        });
        updated.push(kc.id);
      }
    }
    return NextResponse.json({ created, updated });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Importieren", detail: err?.message }, { status: 500 });
  }
}