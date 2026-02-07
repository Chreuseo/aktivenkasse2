type SepaConfig = {
  creditorName: string;
  creditorId: string; // Gläubiger-ID
  initiatingPartyName: string;
};

function getEnv(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function getSepaConfig(): SepaConfig {
  const creditorName = getEnv("SEPA_CREDITOR_NAME");
  const creditorId = getEnv("SEPA_CREDITOR_ID");
  const initiatingPartyName = getEnv("SEPA_INITIATING_PARTY_NAME") ?? creditorName;

  const missing: string[] = [];
  if (!creditorName) missing.push("SEPA_CREDITOR_NAME");
  if (!creditorId) missing.push("SEPA_CREDITOR_ID");
  if (!initiatingPartyName) missing.push("SEPA_INITIATING_PARTY_NAME");

  if (missing.length) {
    throw new Error(`SEPA Konfiguration unvollständig (fehlend: ${missing.join(", ")})`);
  }

  return {
    creditorName: creditorName!,
    creditorId: creditorId!,
    initiatingPartyName: initiatingPartyName!,
  };
}
