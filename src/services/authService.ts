import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { getToken } from "next-auth/jwt";

const AUTH_ORDER = [
  AuthorizationType.none,
  AuthorizationType.read_own,
  AuthorizationType.read_all,
  AuthorizationType.write_all,
];

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
  if (!Object.values(ResourceType).includes(resource)) {
    return { allowed: false, error: "Invalid resource" };
  }
  if (!Object.values(AuthorizationType).includes(requiredPermission)) {
    return { allowed: false, error: "Invalid permission" };
  }

  // Nutzer laden
  let user;
  if (!isNaN(Number(userId))) {
    user = await prisma.user.findUnique({ where: { id: Number(userId) }, include: { roles: true } });
  } else {
    user = await prisma.user.findUnique({ where: { keycloak_id: userId }, include: { roles: true } });
  }
  if (!user) return { allowed: false, error: "User not found" };

  // Rollenquelle 1: direkte DB-Rollen des Nutzers
  const dbUserRoles = user.roles || [];

  // Rollenquelle 2: Rollen aus JWT (NextAuth: teils unter jwt.user.*)
  let jwtRoles: string[] = [];
  if (jwt) {
    const fromRoot = (jwt.realm_access?.roles as string[] | undefined) || (jwt.roles as string[] | undefined) || [];
    const fromUser = (jwt.user?.realm_access?.roles as string[] | undefined) || (jwt.user?.roles as string[] | undefined) || [];
    jwtRoles = [...fromRoot, ...fromUser].filter(Boolean);
  }

  // DB-Rollen anhand der JWT-Rollennamen ergänzen
  let dbRolesFromJwt: any[] = [];
  if (jwtRoles.length > 0) {
    dbRolesFromJwt = await prisma.role.findMany({ where: { name: { in: jwtRoles } } });
  }

  // Gesamte Rollmenge bilden (direkte + aus JWT) und prüfen
  const allRoles = [...dbUserRoles, ...dbRolesFromJwt];
  for (const role of allRoles) {
    const perm = (role as any)[resource] as AuthorizationType;
    if (permissionSufficient(perm, requiredPermission)) {
      return { allowed: true, role, source: role.userId ? "direct" : "member" } as any;
    }
  }

  return { allowed: false, role: null, source: "none" } as any;
}

export function extractTokenAndUserId(req: any): { token: string | null, userId: string | null, jwt: any } {
  let auth: string | undefined;
  if (req.headers && typeof req.headers.get === "function") {
    auth = req.headers.get("authorization") || req.headers.get("Authorization");
  } else if (req.headers && (typeof req.headers === "object")) {
    auth = (req.headers as any)["authorization"] || (req.headers as any)["Authorization"];
  }
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

export function getUserIdFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}

export async function checkPermission(req: Request, resource: ResourceType, requiredPermission: AuthorizationType): Promise<{ allowed: boolean, error?: string }> {
  let { token, userId, jwt } = extractTokenAndUserId(req);

  if (!token || !userId) {
    try {
      const nextAuthToken: any = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
      if (nextAuthToken) {
        jwt = nextAuthToken;
        token = nextAuthToken.accessToken || nextAuthToken.token || null;
        // NextAuth speichert die Keycloak sub i. d. R. unter token.user.sub
        userId = nextAuthToken.sub || nextAuthToken.userId || nextAuthToken.id || nextAuthToken.user?.sub || null;
      }
    } catch {}
  }

  if (!token) return { allowed: false, error: "Kein Token" };
  if (!userId) return { allowed: false, error: "Keine UserId im Token" };

  const result = await validateUserPermissions({ userId, resource, requiredPermission, jwt });
  return { allowed: result.allowed, error: (result as any).error };
}
