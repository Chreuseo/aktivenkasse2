import { NextResponse } from "next/server";
import { resolveEnv } from "@/lib/keycloakUtils";

export async function GET() {
  // Bevorzugte Keys: NEXT_PUBLIC_COMPANY, CUSTOM_CORPORATION
  const company = resolveEnv("WEB_TITLE") || "";
  return NextResponse.json({ webtitle: company });
}

