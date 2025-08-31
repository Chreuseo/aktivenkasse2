// typescript
import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth, { NextAuthOptions } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

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
          token.accessToken = account.access_token; // JWT speichern
          const decoded = decode(account.access_token);
          token.user = {
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
        }
        return token;
      },
      async session({ session, token }) {
        session.user = token.user;
        session.token = token.accessToken; // JWT ins Session-Objekt
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