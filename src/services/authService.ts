import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

const AUTH_ORDER = [
  AuthorizationType.none,
  AuthorizationType.read_own,
  AuthorizationType.read_all,
  AuthorizationType.write_all,
];

// Typangleichung für Berechtigungen
function permissionSufficient(actual: AuthorizationType | string, required: AuthorizationType) {
  return AUTH_ORDER.indexOf(actual as AuthorizationType) >= AUTH_ORDER.indexOf(required);
}

export async function validateUserPermissions({ userId, resource, requiredPermission, jwt }: {
  userId: string;
  resource: ResourceType;
  requiredPermission: AuthorizationType;
  jwt: any;
}) {
  if (!userId || !resource || !requiredPermission) {
    return { allowed: false, error: "Missing fields" };
  }
  // Typsicherheit: Ressourcen- und Berechtigungs-Enum validieren
  if (!Object.values(ResourceType).includes(resource)) {
    return { allowed: false, error: "Invalid resource" };
  }
  if (!Object.values(AuthorizationType).includes(requiredPermission)) {
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
  if (!user) {
    return { allowed: false, error: "User not found" };
  }
  // 1. Direkte Rolle prüfen
  const directRole = user.roles.find(r => r.userId === user.id);
  if (directRole) {
    const perm = directRole[resource] as AuthorizationType;
    if (permissionSufficient(perm, requiredPermission)) {
      return { allowed: true, role: directRole, source: "direct" };
    } else {
      return { allowed: false, role: directRole, source: "direct" };
    }
  }
  // 2. Rollen-Mitgliedschaften prüfen (Keycloak-Rollen aus JWT oder DB)
  let memberRoles = user.roles.filter(r => !r.userId);
  let jwtRoles: string[] = [];
  if (jwt) {
    if (jwt.realm_access?.roles) jwtRoles = jwt.realm_access.roles;
    if (jwt.roles) jwtRoles = jwtRoles.concat(jwt.roles);
  }
  if (jwtRoles.length > 0) {
    const dbRoles = await prisma.role.findMany({ where: { name: { in: jwtRoles } } });
    memberRoles = memberRoles.concat(dbRoles);
  }
  for (const role of memberRoles) {
    const perm = role[resource] as AuthorizationType;
    if (permissionSufficient(perm, requiredPermission)) {
      return { allowed: true, role, source: "member" };
    }
  }
  // Keine passende Rolle gefunden
  return { allowed: false, role: null, source: "none" };
}

// Extrahiere Token und UserId aus Request
export function extractTokenAndUserId(req: Request): { token: string | null, userId: string | null, jwt: any } {
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
        userId = jwt.sub || jwt.userId || jwt.id || null;
      } catch {}
    }
  }
  return { token, userId, jwt };
}

// Zentrale Berechtigungsprüfung für API-Routen
export async function checkPermission(req: Request, resource: ResourceType, requiredPermission: AuthorizationType): Promise<{ allowed: boolean, error?: string }> {
  const { token, userId, jwt } = extractTokenAndUserId(req);
  if (!token) return { allowed: false, error: "Kein Token" };
  if (!userId) return { allowed: false, error: "Keine UserId im Token" };
  const result = await validateUserPermissions({
    userId,
    resource,
    requiredPermission,
    jwt,
  });
  return { allowed: result.allowed, error: result.error };
}
