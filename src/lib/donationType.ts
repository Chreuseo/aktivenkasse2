// Zentrale Abbildung zwischen DB-Enum (Prisma) und UI-Enum.
// Hintergrund: DB nutzt `waive_fees`, UI nutzt das lesbarere `waiver`.

export type DonationTypeDb = 'financial' | 'material' | 'waive_fees';
export type DonationTypeUi = 'financial' | 'material' | 'waiver';

export function donationTypeDbToUi(t: unknown): DonationTypeUi {
  if (t === 'financial') return 'financial';
  if (t === 'material') return 'material';
  if (t === 'waive_fees') return 'waiver';

  // Bei Drift/Alt-Daten nicht hart failen, aber sinnvoll degradiert anzeigen.
  if (t === 'waiver') return 'waiver';

  return 'financial';
}

export function donationTypeUiToDb(t: unknown): DonationTypeDb {
  if (t === 'financial') return 'financial';
  if (t === 'material') return 'material';
  if (t === 'waiver') return 'waive_fees';

  // toleranter Fallback
  if (t === 'waive_fees') return 'waive_fees';

  return 'financial';
}
