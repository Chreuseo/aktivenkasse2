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
  const body = await req.json();
  const { userId, resource, requiredPermission, jwt } = body;
  if (!userId || !resource || !requiredPermission) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!Object.values(ResourceType).includes(resource)) {
    return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
  }
  if (!Object.values(AuthorizationType).includes(requiredPermission)) {
    return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
  }
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
    return NextResponse.json({ allowed: false, error: "User not found" }, { status: 404 });
  }
  const directRole = user.roles.find(r => r.userId === user.id);
  if (directRole) {
    const perm = directRole[resource];
    if (AUTH_ORDER.indexOf(perm) >= AUTH_ORDER.indexOf(requiredPermission)) {
      return NextResponse.json({ allowed: true, role: directRole, source: "direct" });
    } else {
      return NextResponse.json({ allowed: false, role: directRole, source: "direct" }, { status: 403 });
    }
  }
  let memberRoles: any[] = [];
  let jwtRoles: string[] = [];
  if (jwt) {
    if (jwt.realm_access?.roles) jwtRoles = jwt.realm_access.roles;
    if (jwt.roles) jwtRoles = jwtRoles.concat(jwt.roles);
  }
  memberRoles = user.roles.filter(r => !r.userId);
  if (jwtRoles.length > 0) {
    const dbRoles = await prisma.role.findMany({ where: { name: { in: jwtRoles } } });
    memberRoles = memberRoles.concat(dbRoles);
  }
  for (const role of memberRoles) {
    const perm = role[resource];
    if (AUTH_ORDER.indexOf(perm) >= AUTH_ORDER.indexOf(requiredPermission)) {
      return NextResponse.json({ allowed: true, role, source: "member" });
    }
  }
  return NextResponse.json({ allowed: false, role: null, source: "none" }, { status: 403 });
}
