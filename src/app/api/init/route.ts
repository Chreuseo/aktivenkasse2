import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";
import { ensureKeycloakRolePrefixed } from "@/lib/keycloakRolePrefix";

function getEnvInit(key: string): string | undefined {
  // Versucht mehrere Schreibweisen (UPPER_SNAKE, lower_snake, Capitalized)
  const variants = [
    key.toUpperCase(),
    key.toLowerCase(),
    key[0].toUpperCase() + key.slice(1).toLowerCase(),
  ];
  return resolveEnv(...variants);
}

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
  return { base: normalizeBaseUrl(baseRaw), realm } as const;
}

async function ensureKeycloakRole(token: string, nameInput: string) {
  const { base, realm } = await kcBaseAndRealm();
  const roleName = ensureKeycloakRolePrefixed(nameInput);
  // Erstellen (201) oder bereits vorhanden (409)
  const createRes = await fetch(`${base}/admin/realms/${realm}/roles`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: roleName }),
  });
  if (!(createRes.status === 201 || createRes.status === 409)) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Keycloak create role failed: ${createRes.status} ${txt}`);
  }
  // Role by name holen für ID
  const getRes = await fetch(`${base}/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) {
    const txt = await getRes.text().catch(() => "");
    throw new Error(`Keycloak get role failed: ${getRes.status} ${txt}`);
  }
  const role = await getRes.json();
  return { id: role.id as string, name: role.name as string };
}

async function ensureDbRoleWriteAll(kcRole: { id: string; name: string }) {
  // Upsert anhand keycloak_id
  const exists = await prisma.role.findUnique({ where: { keycloak_id: kcRole.id } });
  const dataBase = {
    name: kcRole.name,
    keycloak_id: kcRole.id,
    overview: "write_all" as const,
    mails: "write_all" as const,
    budget_plan: "write_all" as const,
    userAuth: "write_all" as const,
    clearing_accounts: "write_all" as const,
    bank_accounts: "write_all" as const,
    transactions: "write_all" as const,
    advances: "write_all" as const,
  };
  if (!exists) {
    return prisma.role.create({ data: dataBase });
  }
  return prisma.role.update({ where: { id: exists.id }, data: dataBase });
}

async function createOrFindKeycloakUser(
  token: string,
  firstName: string,
  lastName: string,
  email: string,
  password?: string
): Promise<string> {
  const { base, realm } = await kcBaseAndRealm();
  const body: any = { username: email, email, firstName, lastName, enabled: true };
  if (password) body.credentials = [{ type: "password", value: password, temporary: false }];
  const createRes = await fetch(`${base}/admin/realms/${realm}/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (createRes.status === 201) {
    const loc = createRes.headers.get("location") || "";
    const id = loc.split("/").pop() || null;
    if (!id) throw new Error("Kein Keycloak id in Location header");
    return id;
  }
  if (createRes.status === 409) {
    const findRes = await fetch(`${base}/admin/realms/${realm}/users?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!findRes.ok) {
      const txt = await findRes.text().catch(() => "");
      throw new Error(`Keycloak user search failed: ${findRes.status} ${txt}`);
    }
    const users = await findRes.json();
    if (Array.isArray(users) && users.length > 0 && users[0].id) return users[0].id as string;
    throw new Error("User existiert, konnte aber nicht gefunden werden");
  }
  const txt = await createRes.text().catch(() => "");
  throw new Error(`Keycloak create user failed: ${createRes.status} ${txt}`);
}

async function ensureLocalUser(email: string, firstName: string, lastName: string, keycloakId: string) {
  const existing = await prisma.user.findUnique({ where: { mail: email } });
  if (existing) {
    if (existing.keycloak_id !== keycloakId) {
      return prisma.user.update({ where: { id: existing.id }, data: { keycloak_id: keycloakId, first_name: firstName, last_name: lastName } });
    }
    return existing;
  }
  const account = await prisma.account.create({ data: { balance: 0, interest: true, type: "user" } });
  const user = await prisma.user.create({
    data: {
      first_name: firstName,
      last_name: lastName,
      mail: email,
      keycloak_id: keycloakId,
      accountId: account.id,
    },
  });
  return user;
}

async function assignRoleToUser(token: string, kcUserId: string, kcRole: { id: string; name: string }) {
  const { base, realm } = await kcBaseAndRealm();
  const kcUrl = `${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/role-mappings/realm`;
  const payload = [{ id: kcRole.id, name: kcRole.name }];
  const res = await fetch(kcUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!(res.status === 204 || res.status === 201)) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Keycloak role-assign failed: ${res.status} ${txt}`);
  }
}

export async function POST() {
  try {
    // ENV lesen
    const roleRaw = getEnvInit("init_admin_role");
    const mail = getEnvInit("init_admin_mail");
    const firstName = getEnvInit("init_admin_first_name");
    const lastName = getEnvInit("init_admin_last_name");

    const missing: string[] = [];
    if (!roleRaw) missing.push("init_admin_role");
    if (!mail) missing.push("init_admin_mail");
    if (!firstName) missing.push("init_admin_first_name");
    if (!lastName) missing.push("init_admin_last_name");
    if (missing.length) {
      return NextResponse.json({ error: "Fehlende ENV Variablen", missing }, { status: 400 });
    }

    const token = await getKeycloakToken();

    // Rolle sicherstellen (Keycloak + DB write_all)
    const kcRole = await ensureKeycloakRole(token, roleRaw!);
    const dbRole = await ensureDbRoleWriteAll(kcRole);

    // User sicherstellen (Keycloak + lokal)
    const tempPassword = Math.random().toString(36).slice(2, 12);
    const kcUserId = await createOrFindKeycloakUser(token, firstName!, lastName!, mail!, tempPassword);
    const dbUser = await ensureLocalUser(mail!, firstName!, lastName!, kcUserId);

    // Zuweisung der Rolle in Keycloak
    await assignRoleToUser(token, kcUserId, kcRole);

    return NextResponse.json({
      ok: true,
      role: { id: dbRole.id, name: dbRole.name, keycloak_id: dbRole.keycloak_id },
      user: { id: dbUser.id, mail: dbUser.mail, keycloak_id: dbUser.keycloak_id },
      note: "Rolle mit write_all gesetzt, User erstellt/gefunden und zugewiesen",
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Init fehlgeschlagen", detail: err?.message }, { status: 500 });
  }
}

