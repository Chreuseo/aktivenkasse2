// src/lib/keycloakUtils.ts

export function resolveEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    if (typeof process.env[k] === "string" && process.env[k]!.length > 0) return process.env[k]!;
  }
  return undefined;
}

export function normalizeBaseUrl(base: string): string {
  return base.replace(/\/+$/, "");
}

export async function getKeycloakToken(): Promise<string> {
  const baseRaw = resolveEnv(
    "KEYCLOAK_BASE_URL",
    "KEYCLOAK_BASEURL",
    "KEYCLOAK_URL",
    "KEYCLOAK_HOST",
    "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
  );
  const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
  const clientId = resolveEnv("KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID");
  const clientSecret = resolveEnv("KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET_KEY");

  const missing: string[] = [];
  if (!baseRaw) missing.push("KEYCLOAK_BASE_URL");
  if (!realm) missing.push("KEYCLOAK_REALM");
  if (!clientId) missing.push("KEYCLOAK_CLIENT_ID");
  if (!clientSecret) missing.push("KEYCLOAK_CLIENT_SECRET");
  if (missing.length) throw new Error("Missing Keycloak env: " + missing.join(", "));

  const base = normalizeBaseUrl(baseRaw!);
  const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId!);
  params.append("client_secret", clientSecret!);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Keycloak token error: ${res.status} ${txt}`);
  }
  const json = await res.json();
  if (!json?.access_token) throw new Error("No access_token");
  return json.access_token as string;
}

