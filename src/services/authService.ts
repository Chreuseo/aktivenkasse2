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

export async function validateUserPermissions({ userId, resource, requiredPermission, jwt }: {
  userId: string;
  resource: ResourceType;
  requiredPermission: AuthorizationType;
  jwt: any;
}) {
  if (!userId || !resource || !requiredPermission) {
    console.warn("[validateUserPermissions] Fehlende Felder", { userId, resource, requiredPermission });
    return { allowed: false, error: "Missing fields" };
  }
  // Typsicherheit: Ressourcen- und Berechtigungs-Enum validieren
  if (!Object.values(ResourceType).includes(resource)) {
    console.warn("[validateUserPermissions] Ungültige Ressource", resource);
    return { allowed: false, error: "Invalid resource" };
  }
  if (!Object.values(AuthorizationType).includes(requiredPermission)) {
    console.warn("[validateUserPermissions] Ungültige Berechtigung", requiredPermission);
    return { allowed: false, error: "Invalid permission" };
  }
  // User anhand ID oder Keycloak-ID suchen
  let user;
  if (!isNaN(Number(userId))) {
    user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { roles: true },
    });
  } else {
    user = await prisma.user.findUnique({
      where: { keycloak_id: userId },
      include: { roles: true },
    });
  }
  console.log("[validateUserPermissions] User:", user);
  if (!user) {
    console.warn("[validateUserPermissions] User nicht gefunden", userId);
    return { allowed: false, error: "User not found" };
  }
  console.log("[validateUserPermissions] Rollen des Users:", user.roles);
  // 1. Direkte Rolle prüfen
  const directRole = user.roles.find(r => r.userId === user.id);
  if (directRole) {
    const perm = directRole[resource];
    console.log("[validateUserPermissions] Direkte Rolle:", directRole, "Berechtigung:", perm);
    if (permissionSufficient(perm, requiredPermission)) {
      console.log("[validateUserPermissions] Zugriff erlaubt durch direkte Rolle");
      return { allowed: true, role: directRole, source: "direct" };
    } else {
      console.warn("[validateUserPermissions] Zugriff verweigert durch direkte Rolle", perm, requiredPermission);
      return { allowed: false, role: directRole, source: "direct" };
    }
  }
  // 2. Rollen-Mitgliedschaften prüfen (Keycloak-Rollen aus JWT oder DB)
  let memberRoles: any[] = [];
  let jwtRoles: string[] = [];
  if (jwt) {
    if (jwt.realm_access?.roles) jwtRoles = jwt.realm_access.roles;
    if (jwt.roles) jwtRoles = jwtRoles.concat(jwt.roles);
  }
  console.log("[validateUserPermissions] JWT-Rollen:", jwtRoles);
  memberRoles = user.roles.filter(r => !r.userId);
  console.log("[validateUserPermissions] Mitgliedsrollen aus DB:", memberRoles);
  if (jwtRoles.length > 0) {
    const dbRoles = await prisma.role.findMany({ where: { name: { in: jwtRoles } } });
    console.log("[validateUserPermissions] Rollen aus DB zu JWT:", dbRoles);
    memberRoles = memberRoles.concat(dbRoles);
  }
  for (const role of memberRoles) {
    const perm = role[resource];
    console.log("[validateUserPermissions] Mitgliedsrolle:", role, "Berechtigung:", perm);
    if (permissionSufficient(perm, requiredPermission)) {
      console.log("[validateUserPermissions] Zugriff erlaubt durch Mitgliedsrolle");
      return { allowed: true, role, source: "member" };
    }
  }
  // Keine passende Rolle gefunden
  console.warn("[validateUserPermissions] Keine passende Rolle gefunden", { userId, resource, requiredPermission });
  return { allowed: false, role: null, source: "none" };
}
