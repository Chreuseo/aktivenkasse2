// typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Spezielles Handling: favicon ohne Query ausliefern
  if (pathname === "/favicon.ico") {
    if (search) {
      const cleanUrl = new URL(req.url);
      cleanUrl.search = "";
      return NextResponse.redirect(cleanUrl, { status: 302 });
    }
    return NextResponse.next();
  }

  // Öffentliche Pfade durchlassen
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/cron" || // Cron-API offen lassen, da sie sich selbst mit Secret schützt
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  // Wenn API-Request mit Bearer-Header kommt, durchlassen (Auth prüft dann die Route selbst)
  const bearer = req.headers.get("authorization") || req.headers.get("Authorization");
  if (pathname.startsWith("/api") && bearer && /^Bearer\s+\S+$/i.test(bearer)) {
    return NextResponse.next();
  }

  // Token aus NextAuth prüfen (Cookies)
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  const token = await getToken({ req, secret });

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
  // Matcher schützt Seiten und alle API-Routen (außer /api/auth) und enthält favicon explizit
  matcher: ["/", "/favicon.ico", "/((?!_next|favicon.ico|login|api/auth).*)", "/api/:path*"],
};