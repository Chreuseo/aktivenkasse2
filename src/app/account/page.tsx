import AccountClient from "./AccountClient";
import { normalizeBaseUrl, resolveEnv } from "@/lib/keycloakUtils";

export default async function AccountPage() {
  const baseRaw = resolveEnv(
    "KEYCLOAK_BASE_URL",
    "KEYCLOAK_BASEURL",
    "KEYCLOAK_URL",
    "KEYCLOAK_HOST",
    "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
  );
  const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");

  let accountUrl: string | undefined;
  if (baseRaw && realm) {
    const base = normalizeBaseUrl(baseRaw);
    accountUrl = `${base}/realms/${realm}/account`;
  }

  return <AccountClient accountUrl={accountUrl} />;
}
