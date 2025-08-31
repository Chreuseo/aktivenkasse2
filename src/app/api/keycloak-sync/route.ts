// Datei: src/app/api/keycloak-sync/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { validateUserPermissions } from "@/services/authService";

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
  // normalize to minimal shape
  return out.map((u: any) => ({
    id: u.id,
    username: u.username,
    email: u.email || u.emailVerified || "",
    firstName: u.firstName || "",
    lastName: u.lastName || "",
  }));
}

function extractTokenAndUserId(req: Request): { token: string | null, userId: string | null, jwt: any } {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  let token: string | null = null;
  let userId: string | null = null;
  let jwt: any = null;
  if (auth) {
    const match = auth.match(/^Bearer (.+)$/);
    if (match) {
      token = match[1];
      try {
        jwt = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
        userId = jwt.sub || jwt.userId || null;
      } catch {}
    }
  }
  return { token, userId, jwt };
}

async function checkUserAuthPermission(req: Request, requiredPermission: AuthorizationType): Promise<{ allowed: boolean, error?: string }> {
  const { token, userId, jwt } = extractTokenAndUserId(req);
  if (!token) return { allowed: false, error: "Kein Token" };
  if (!userId) return { allowed: false, error: "Keine UserId im Token" };
  const result = await validateUserPermissions({
    userId,
    resource: ResourceType.userAuth,
    requiredPermission,
    jwt,
  });
  return { allowed: !!result.allowed, error: result.error };
}

export async function GET(req: Request) {
  // Rechteprüfung: userAuth/read_all
  const perm = await checkUserAuthPermission(req, AuthorizationType.read_all);
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
  // Rechteprüfung: userAuth/write_all
  const perm = await checkUserAuthPermission(req, AuthorizationType.write_all);
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