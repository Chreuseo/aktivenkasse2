import { NextResponse } from "next/server";
import { resolveEnv } from "@/lib/keycloakUtils";

export async function GET() {
  // Bevorzugte Keys: NEXT_PUBLIC_COMPANY, CUSTOM_CORPORATION
  const company = resolveEnv("NEXT_PUBLIC_COMPANY", "CUSTOM_CORPORATION") || "";

  const webTitle = process.env.WEB_TITLE;
  if (typeof webTitle !== "string" || webTitle.trim().length === 0) {
    return NextResponse.json({ error: "Missing env WEB_TITLE" }, { status: 500 });
  }

  return NextResponse.json({ company, webTitle: webTitle.trim() });
}
