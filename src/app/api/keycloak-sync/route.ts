// Datei: src/app/api/keycloak-sync/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";

function normalizeAttrString(v: unknown): string {
  // Keycloak attributes können string oder string[] sein; wir nehmen den ersten Eintrag als string
  if (v == null) return "";
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    const first = v[0];
    return typeof first === "string" ? first : String(first ?? "");
  }
  return typeof v === "string" ? v : String(v ?? "");
}
function normalizeAttrBoolFrom01(v: unknown): boolean {
  // Erwartete Werte: "0"/0 => false, "1"/1 => true, sonst: truthy string => true
  if (Array.isArray(v)) v = v[0];
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  if (typeof v === "boolean") return v;
  const s = typeof v === "string" ? v.trim().toLowerCase() : String(v ?? "").trim().toLowerCase();
  if (s === "" || s === "false" || s === "no" || s === "nein") return false;
  return Boolean(s);
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
  return out.map((u: any) => {
    const attrs = u.attributes || {};
    const street = normalizeAttrString(attrs["strasse"]);
    const plz = normalizeAttrString(attrs["plz"]);
    const ort = normalizeAttrString(attrs["ort"]);
    const status = normalizeAttrString(attrs["status"]);
    const hvMitglied = normalizeAttrBoolFrom01(attrs["hv-mitglied"]);
    return {
      id: u.id,
      username: u.username,
      email: u.email || "",
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      enabled: Boolean(u.enabled),
      street,
      postalCode: plz,
      city: ort,
      status,
      hv_member: hvMitglied,
    };
  });
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
      select: { id: true, keycloak_id: true, mail: true, first_name: true, last_name: true, Street: true, postalCode: true, City: true, Status: true, HV_Mitglied: true },
    });
    const dbMap = new Map(dbUsers.map(u => [u.keycloak_id, u]));
    const result = kcUsers.map(u => {
      const db = dbMap.get(u.id);
      if (!db) {
        return {
          keycloak_id: u.id,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          enabled: u.enabled,
          status: "new",
          diffs: { first_name: null, last_name: null, mail: null, Street: null, postalCode: null, City: null, Status: null, HV_Mitglied: null },
        };
      }
      const diffs: any = {};
      let changed = false;
      if ((db.first_name || "") !== (u.firstName || "")) { changed = true; diffs.first_name = { from: db.first_name, to: u.firstName }; } else diffs.first_name = null;
      if ((db.last_name || "") !== (u.lastName || "")) { changed = true; diffs.last_name = { from: db.last_name, to: u.lastName }; } else diffs.last_name = null;
      if ((db.mail || "") !== (u.email || "")) { changed = true; diffs.mail = { from: db.mail, to: u.email }; } else diffs.mail = null;
      if ((db.Street || "") !== (u.street || "")) { changed = true; diffs.Street = { from: db.Street, to: u.street }; } else diffs.Street = null;
      if ((db.postalCode || "") !== (u.postalCode || "")) { changed = true; diffs.postalCode = { from: db.postalCode, to: u.postalCode }; } else diffs.postalCode = null;
      if ((db.City || "") !== (u.city || "")) { changed = true; diffs.City = { from: db.City, to: u.city }; } else diffs.City = null;
      if ((db.Status || "") !== (u.status || "")) { changed = true; diffs.Status = { from: db.Status, to: u.status }; } else diffs.Status = null;
      if (Boolean(db.HV_Mitglied) !== Boolean(u.hv_member)) { changed = true; diffs.HV_Mitglied = { from: Boolean(db.HV_Mitglied), to: Boolean(u.hv_member) }; } else diffs.HV_Mitglied = null;
      return {
        keycloak_id: u.id,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        enabled: u.enabled,
        status: changed ? "changed" : "same",
        diffs,
      };
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
      const attrs = u.attributes || {};
      const kc = {
        id: u.id,
        email: u.email || "",
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        street: normalizeAttrString(attrs["strasse"]),
        postalCode: normalizeAttrString(attrs["plz"]),
        city: normalizeAttrString(attrs["ort"]),
        status: normalizeAttrString(attrs["status"]),
        hv_member: normalizeAttrBoolFrom01(attrs["hv-mitglied"]),
      };
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
            Street: kc.street,
            postalCode: kc.postalCode,
            City: kc.city,
            Status: kc.status,
            HV_Mitglied: kc.hv_member,
          },
        });
        created.push(kc.id);
      } else {
        await prisma.user.update({
          where: { keycloak_id: kc.id },
          data: {
            first_name: kc.firstName,
            last_name: kc.lastName,
            mail: kc.email,
            Street: kc.street,
            postalCode: kc.postalCode,
            City: kc.city,
            Status: kc.status,
            HV_Mitglied: kc.hv_member,
          },
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

export async function PATCH(req: Request) {
  const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für Keycloak-Sync-Änderung" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const id: string | undefined = body?.id;
    const enabled: unknown = body?.enabled;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Ungültige oder fehlende ID" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "'enabled' muss boolean sein" }, { status: 400 });
    }
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

    // 1) Aktuelle Repräsentation laden
    const getRes = await fetch(`${base}/admin/realms/${realm}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!getRes.ok) {
      const text = await getRes.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-User nicht gefunden: ${getRes.status} ${text}` }, { status: 404 });
    }
    const current = await getRes.json();

    // 2) enabled toggeln und PUT senden (volle Repräsentation)
    const updatedPayload = { ...current, enabled };
    const putRes = await fetch(`${base}/admin/realms/${realm}/users/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedPayload),
    });
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      return NextResponse.json({ error: `Keycloak-Update fehlgeschlagen: ${putRes.status} ${text}` }, { status: 502 });
    }
    return NextResponse.json({ id, enabled });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Fehler beim Aktualisieren des Keycloak-Status", detail: err?.message }, { status: 500 });
  }
}
