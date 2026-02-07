import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission } from '@/services/authService';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { createDonationForTransaction, type DonationTypeUi } from '@/services/donationService';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body' }, { status: 400 });
  }

  const rows: Array<{ transactionId: number; description: string; type: DonationTypeUi }> = Array.isArray(body?.rows)
    ? body.rows
    : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Keine Einträge zum Erzeugen übergeben' }, { status: 400 });
  }

  const txIds = rows.map((r) => Number(r.transactionId)).filter((n) => Number.isFinite(n));
  const txs = await prisma.transaction.findMany({
    where: { id: { in: txIds } },
    include: { account: { include: { users: true } }, costCenter: true, donations: true },
  });
  const txById = new Map<number, any>(txs.map((t: any) => [t.id, t]));

  const created: number[] = [];
  const skipped: Array<{ transactionId: number; reason: string }> = [];

  await prisma.$transaction(async (p: any) => {
    for (const r of rows) {
      const tx = txById.get(Number(r.transactionId));
      if (!tx) {
        skipped.push({ transactionId: Number(r.transactionId), reason: 'Transaktion nicht gefunden' });
        continue;
      }
      if (!tx.costCenter || tx.costCenter.is_donation !== true) {
        skipped.push({ transactionId: tx.id, reason: 'Transaktion ist keine Spenden-Kostenstelle' });
        continue;
      }
      if (!tx.account?.users || tx.account.users.length === 0) {
        skipped.push({ transactionId: tx.id, reason: 'Transaktion gehört zu keinem Nutzeraccount' });
        continue;
      }
      if (tx.donations && tx.donations.length > 0) {
        skipped.push({ transactionId: tx.id, reason: 'Zuwendungsbescheid existiert bereits' });
        continue;
      }

      try {
        const createdDonation = await createDonationForTransaction(p, {
          transactionId: tx.id,
          description: String(r.description || tx.description),
          type: (r.type || 'financial') as DonationTypeUi,
          processorId: currentUser.id,
        });
        created.push(createdDonation.id);
      } catch (e: any) {
        const msg = String(e?.message || 'Erzeugen fehlgeschlagen');
        skipped.push({ transactionId: tx.id, reason: msg });
      }
    }
  });

  return NextResponse.json({ created, skipped }, { status: 201 });
}
