// typescript
import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth, { NextAuthOptions } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/prisma";

const {
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_ISSUER: RAW_ISSUER,
  NEXTAUTH_SECRET,
} = process.env;

function sanitizeIssuer(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/\s+/)[0].trim(); // entfernt versehentlich eingefügten Text
  if (!first) return null;
  return first.replace(/\/$/, ""); // entferne trailing slash
}

async function validateDiscovery(issuerBase: string) {
  const wellKnown = `${issuerBase}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(wellKnown);
  } catch (e: any) {
    throw new Error(`Failed to fetch ${wellKnown}: ${String(e)}`);
  }
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 400));
    throw new Error(`OIDC discovery returned ${res.status}: ${body}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const body = await res.text().then((t) => t.slice(0, 400));
    throw new Error(`OIDC discovery did not return JSON (content-type=${ct}) body=${body}`);
  }
  await res.json(); // parse zur Validierung
}

function buildAuthOptions(issuerBase: string): NextAuthOptions {
  return {
    adapter: PrismaAdapter(prisma),
    providers: [
      KeycloakProvider({
        clientId: KEYCLOAK_CLIENT_ID!,
        clientSecret: KEYCLOAK_CLIENT_SECRET!,
        issuer: issuerBase,
      }),
    ],
    secret: NEXTAUTH_SECRET,
    session: { strategy: "database" },
    callbacks: {
      async session({ session, user }) {
        if (session.user) (session.user as any).id = user.id;
        return session;
      },
      async signIn({ user, account }) {
        try {
          if (account?.provider === "keycloak" && account.providerAccountId) {
            await prisma.user.update({
              where: { id: Number(user.id) },
              data: { keycloak_id: account.providerAccountId },
            });
          }
        } catch {
          // Nicht blockierend — Fehler loggen optional
        }
        return true;
      },
    },
    pages: { signIn: "/auth/signin" },
  };
}

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  if (!KEYCLOAK_CLIENT_ID || !KEYCLOAK_CLIENT_SECRET || !RAW_ISSUER || !NEXTAUTH_SECRET) {
    console.error("Missing required env vars for NextAuth.");
    return res.status(500).json({ error: "Missing required server environment variables." });
  }

  const issuer = sanitizeIssuer(RAW_ISSUER);
  if (!issuer) {
    console.error("KEYCLOAK_ISSUER seems empty or invalid.");
    return res.status(500).json({ error: "Invalid KEYCLOAK_ISSUER." });
  }

  try {
    await validateDiscovery(issuer);
  } catch (e: any) {
    console.error("Keycloak OIDC discovery failed:", e);
    return res.status(500).json({
      error: `Failed to fetch Keycloak OIDC discovery at ${issuer}: ${e?.message ?? String(e)}`,
    });
  }

  const authOptions = buildAuthOptions(issuer);
  return NextAuth(req, res, authOptions);
}