// typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Öffentliche Pfade durchlassen
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/favicon.ico" ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  // Token aus NextAuth prüfen
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Kein Token -> API: 401, Pages: redirect auf /login
  if (!token) {
    if (pathname.startsWith("/api")) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // Eingeloggt -> weiter
  return NextResponse.next();
}

export const config = {
  // Matcher schützt Seiten und alle API-Routen (außer /api/auth)
  matcher: ["/", "/((?!_next|favicon.ico|login|api/auth).*)", "/api/:path*"],
};