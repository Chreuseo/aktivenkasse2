import { resolveEnv } from "@/lib/keycloakUtils";

export type KeycloakRolePrefixOptions = {
  /** Default: "aktivenkasse_" */
  defaultPrefix?: string;
};

/**
 * Liest den Rollen-Präfix aus ENV und normalisiert ihn.
 *
 * ENV:
 * - KEYCLOAK_ROLE_PREFIX (empfohlen)
 * - KEYCLOAK_ROLE_PREFIX_NAME (Fallback)
 *
 * Normalisierung:
 * - trim
 * - "-" -> "_"
 * - wenn nicht leer und nicht auf "_" endet, wird "_" angehängt
 */
export function getKeycloakRolePrefix(opts: KeycloakRolePrefixOptions = {}): string {
  const raw = resolveEnv("KEYCLOAK_ROLE_PREFIX", "KEYCLOAK_ROLE_PREFIX_NAME");
  const fallback = opts.defaultPrefix ?? "fallback-role-kasse_";

  const val = (raw ?? fallback).trim();
  if (!val) return "";

  const normalizedBase = val.replace(/-+/g, "_");
  return normalizedBase.endsWith("_") ? normalizedBase : `${normalizedBase}_`;
}

export function hasKeycloakRolePrefix(roleName: string, prefix = getKeycloakRolePrefix()): boolean {
  if (!prefix) return true;
  return roleName.startsWith(prefix);
}

/** Stellt sicher, dass genau ein Präfix vorhanden ist (idempotent). */
export function ensureKeycloakRolePrefixed(nameInput: string, prefix = getKeycloakRolePrefix()): string {
  const name = (nameInput ?? "").trim();
  if (!prefix) return name;
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

/** Entfernt den Präfix nur für Anzeigezwecke (idempotent). */
export function stripKeycloakRolePrefix(roleName: string, prefix = getKeycloakRolePrefix()): string {
  if (!prefix) return roleName;
  return roleName.startsWith(prefix) ? roleName.slice(prefix.length) : roleName;
}
