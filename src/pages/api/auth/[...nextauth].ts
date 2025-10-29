// typescript
import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth, { NextAuthOptions } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import prisma from "@/lib/prisma";

const {
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_ISSUER: RAW_ISSUER,
  NEXTAUTH_SECRET,
} = process.env;

function sanitizeIssuer(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/\s+/)[0].trim();
  if (!first) return null;
  return first.replace(/\/$/, "");
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
  await res.json();
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

// Leitet aus dem Keycloak-Token robuste Vor-/Nachnamen und eine E-Mail ab
function deriveIdentity(decoded: any): { sub: string; first_name: string; last_name: string; email: string } {
  const sub: string | undefined = decoded?.sub;
  const emailRaw: string | undefined = decoded?.email;
  const given: string | undefined = decoded?.given_name;
  const family: string | undefined = decoded?.family_name;
  const preferred: string | undefined = decoded?.preferred_username;
  const name: string | undefined = decoded?.name;

  let first = given || "";
  let last = family || "";

  if ((!first || !last) && name && typeof name === "string") {
    const parts = name.trim().split(/\s+/);
    if (!first && parts.length > 0) first = parts[0];
    if (!last && parts.length > 1) last = parts.slice(1).join(" ");
  }
  if (!first) first = preferred || "Keycloak";
  if (!last) last = sub || preferred || "User";

  const email = (emailRaw && String(emailRaw)) || `${preferred || sub}@local.invalid`;

  if (!sub) throw new Error("Missing sub in Keycloak token");
  return { sub, first_name: first, last_name: last, email };
}

async function ensureUserExistsFromToken(decoded: any) {
  const { sub, first_name, last_name, email } = deriveIdentity(decoded);

  // Upsert per keycloak_id; bei Neuanlage direkt ein Konto anlegen
  await prisma.user.upsert({
    where: { keycloak_id: sub },
    update: {
      first_name,
      last_name,
      mail: email,
    },
    create: {
      first_name,
      last_name,
      mail: email,
      keycloak_id: sub,
      account: {
        create: { balance: 0, interest: true, type: "user" },
      },
    },
  });
}

function buildAuthOptions(issuerBase: string): NextAuthOptions {
  return {
    providers: [
      KeycloakProvider({
        clientId: KEYCLOAK_CLIENT_ID!,
        clientSecret: KEYCLOAK_CLIENT_SECRET!,
        issuer: issuerBase,
      }),
    ],
    secret: NEXTAUTH_SECRET,
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60, // 30 Tage
    },
    jwt: {},
    callbacks: {
      async jwt({ token, user, account, profile }) {
        if (account && account.access_token) {
          (token as any).accessToken = account.access_token; // JWT speichern
          const decoded = decode(account.access_token);
          (token as any).user = {
            ...user,
            sub: decoded.sub,
            roles: decoded.realm_access?.roles || [],
            realm_access: decoded.realm_access || {},
            resource_access: decoded.resource_access || {},
            preferred_username: decoded.preferred_username,
            email: decoded.email,
            name: decoded.name,
            given_name: decoded.given_name,
            family_name: decoded.family_name,
            email_verified: decoded.email_verified,
          };

          // Beim ersten Login DB-User automatisch anlegen/aktualisieren
          try {
            await ensureUserExistsFromToken(decoded);
          } catch (e) {
            console.error("Failed to ensure user exists from Keycloak token:", e);
          }
        }
        return token;
      },
      async session({ session, token }) {
        (session as any).user = (token as any).user;
        (session as any).token = (token as any).accessToken; // JWT ins Session-Objekt
        return session;
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