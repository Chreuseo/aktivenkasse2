import { NextResponse } from "next/server";
import { resolveEnv } from "@/lib/keycloakUtils";

export async function GET() {
  // Bevorzugte Keys: NEXT_PUBLIC_COMPANY, CUSTOM_CORPORATION
  const company = resolveEnv("NEXT_PUBLIC_COMPANY", "CUSTOM_CORPORATION") || "";
  return NextResponse.json({ company });
}

