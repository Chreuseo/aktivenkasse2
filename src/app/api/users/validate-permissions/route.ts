import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

const AUTH_ORDER = [
  AuthorizationType.none,
  AuthorizationType.read_own,
  AuthorizationType.read_all,
  AuthorizationType.write_all,
];

function permissionSufficient(actual: AuthorizationType, required: AuthorizationType) {
  return AUTH_ORDER.indexOf(actual) >= AUTH_ORDER.indexOf(required);
}

export async function POST(req: Request) {
  console.log("[validate-permissions] Route wurde aufgerufen", { method: req.method });
  const body = await req.json();
  const { userId, resource, requiredPermission, jwt } = body;
  console.log("[validate-permissions] Eingabe:", { userId, resource, requiredPermission, jwt });
  if (!userId || !resource || !requiredPermission) {
    console.warn("[validate-permissions] Fehlende Felder", { userId, resource, requiredPermission });
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Typsicherheit: Ressourcen- und Berechtigungs-Enum validieren
  if (!Object.values(ResourceType).includes(resource)) {
    console.warn("[validate-permissions] Ungültige Ressource", resource);
    return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
  }
  if (!Object.values(AuthorizationType).includes(requiredPermission)) {
    console.warn("[validate-permissions] Ungültige Berechtigung", requiredPermission);
    return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
  }

  // User anhand ID oder Keycloak-ID suchen
  let user;
  if (!isNaN(Number(userId))) {
    console.log("[validate-permissions] Suche User nach DB-ID", userId);
    user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { roles: true },
    });
  } else {
    console.log("[validate-permissions] Suche User nach Keycloak-ID", userId);
    user = await prisma.user.findUnique({
      where: { keycloak_id: userId },
      include: { roles: true },
    });
  }
  console.log("[validate-permissions] User aus DB:", user);
  if (!user) {
    console.warn("[validate-permissions] User nicht gefunden", userId);
    return NextResponse.json({ allowed: false, error: "User not found" }, { status: 404 });
  }

  // 1. Direkte Rolle prüfen
  const directRole = user.roles.find(r => r.userId === user.id);
  console.log("[validate-permissions] Direkte Rolle:", directRole);
  if (directRole) {
    const perm = directRole[resource];
    console.log("[validate-permissions] Berechtigung direkte Rolle:", perm);
    if (permissionSufficient(perm, requiredPermission)) {
      console.log("[validate-permissions] Zugriff erlaubt durch direkte Rolle");
      return NextResponse.json({ allowed: true, role: directRole, source: "direct" });
    } else {
      console.warn("[validate-permissions] Zugriff verweigert durch direkte Rolle", perm, requiredPermission);
      return NextResponse.json({ allowed: false, role: directRole, source: "direct" }, { status: 403 });
    }
  }

  // 2. Rollen-Mitgliedschaften prüfen (Keycloak-Rollen aus JWT oder DB)
  let memberRoles: any[] = [];
  let jwtRoles: string[] = [];
  if (jwt) {
    if (jwt.realm_access?.roles) jwtRoles = jwt.realm_access.roles;
    if (jwt.roles) jwtRoles = jwtRoles.concat(jwt.roles);
  }
  console.log("[validate-permissions] JWT-Rollen:", jwtRoles);
  memberRoles = user.roles.filter(r => !r.userId);
  console.log("[validate-permissions] Mitgliedsrollen aus DB:", memberRoles);
  if (jwtRoles.length > 0) {
    const dbRoles = await prisma.role.findMany({ where: { name: { in: jwtRoles } } });
    console.log("[validate-permissions] Rollen aus DB zu JWT:", dbRoles);
    memberRoles = memberRoles.concat(dbRoles);
  }
  for (const role of memberRoles) {
    const perm = role[resource];
    console.log("[validate-permissions] Berechtigung Mitgliedsrolle:", { role, perm });
    if (permissionSufficient(perm, requiredPermission)) {
      console.log("[validate-permissions] Zugriff erlaubt durch Mitgliedsrolle");
      return NextResponse.json({ allowed: true, role, source: "member" });
    }
  }

  // Keine passende Rolle gefunden: 403 Forbidden
  console.warn("[validate-permissions] Keine passende Rolle gefunden", { userId, resource, requiredPermission });
  return NextResponse.json({ allowed: false, role: null, source: "none" }, { status: 403 });
}
