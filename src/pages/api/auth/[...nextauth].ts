// typescript
import NextAuth, { NextAuthOptions } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/prisma";

const {
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_ISSUER,
  NEXTAUTH_SECRET,
} = process.env;

if (!KEYCLOAK_CLIENT_ID || !KEYCLOAK_CLIENT_SECRET || !KEYCLOAK_ISSUER || !NEXTAUTH_SECRET) {
  throw new Error(
    "Missing required env vars: KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET, KEYCLOAK_ISSUER, NEXTAUTH_SECRET"
  );
}

const issuerBase = KEYCLOAK_ISSUER.replace(/\/$/, "");
const wellKnown = `${issuerBase}/typescript
// Datei: src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (req.nextUrl.pathname.startsWith('/api')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Passe die Matcher an die zu schützenden Pfade an
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/settings/:path*',
    '/api/protected/:path*'
  ],
};.well-known/openid-configuration`;

try {
  const res = await fetch(wellKnown);
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 400));
    throw new Error(`OIDC discovery returned ${res.status} for ${wellKnown}: ${body}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const body = await res.text().then((t) => t.slice(0, 400));
    throw new Error(`OIDC discovery did not return JSON for ${wellKnown}. content-type=${ct} body=${body}`);
  }
  // optional: parse once to ensure valid JSON
  await res.json();
} catch (e: any) {
  // klare Fehlermeldung im Server-Log, verhindert späteres OPError aus openid-client
  throw new Error(`Failed to fetch Keycloak OIDC discovery at ${wellKnown}: ${e?.message ?? String(e)}`);
}

const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    KeycloakProvider({
      clientId: KEYCLOAK_CLIENT_ID,
      clientSecret: KEYCLOAK_CLIENT_SECRET,
      issuer: issuerBase,
    }),
  ],
  secret: NEXTAUTH_SECRET,
  session: {
    strategy: "database",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as any).id = user.id;
      }
      return session;
    },
    async signIn({ user, account }) {
      try {
        if (account?.provider === "keycloak" && account.providerAccountId) {
          await prisma.user.update({
            where: { id: user.id },
            data: { keycloak_id: account.providerAccountId },
          });
        }
      } catch {
        // Nicht blockierend
      }
      return true;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};

export default NextAuth(authOptions);