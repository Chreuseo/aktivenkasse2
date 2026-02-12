// Zentraler Service für Spenden-/Zuwendungsbescheide (Donation)
// Ziel: Wiederverwendbare Logik außerhalb von API-Routen.

type PrismaTx = any;

export type DonationTypeUi = 'financial' | 'material' | 'waiver';

import { donationTypeUiToDb } from '@/lib/donationType';

function toDbType(t: DonationTypeUi): any {
  // Prisma Enum: DonationType = financial | material | waive_fees
  return donationTypeUiToDb(t);
}

export async function createDonationForTransaction(
  p: PrismaTx,
  params: {
    transactionId: number;
    description: string;
    type: DonationTypeUi;
    processorId: number;
  },
) {
  const { transactionId, description, type, processorId } = params;

  const tx = await p.transaction.findUnique({
    where: { id: transactionId },
    include: { account: { include: { users: true } }, costCenter: true, donations: true },
  });
  if (!tx) throw new Error('Transaktion nicht gefunden');

  if (!tx.costCenter || tx.costCenter.is_donation !== true) {
    throw new Error('Transaktion ist keine Spenden-Kostenstelle');
  }

  if (!tx.account?.users || tx.account.users.length === 0) {
    throw new Error('Transaktion gehört zu keinem Nutzeraccount');
  }

  if (tx.donations && tx.donations.length > 0) {
    throw new Error('Zuwendungsbescheid existiert bereits');
  }

  const txUser = tx.account.users[0];
  const txDateValued: Date | null = tx.date_valued ? new Date(tx.date_valued) : null;
  const txDate: Date | null = tx.date ? new Date(tx.date) : null;
  const date = txDateValued || txDate || new Date();

  const donation = await p.donation.create({
    data: {
      createdAt: new Date(),
      date,
      description: String(description || tx.description),
      amount: Math.abs(Number(tx.amount)),
      type: toDbType(type || 'financial'),
      transactionId: tx.id,
      userId: txUser.id,
      processorId,
    },
  });

  return donation;
}
