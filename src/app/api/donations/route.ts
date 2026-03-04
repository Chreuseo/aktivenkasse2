import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission } from '@/services/authService';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { donationTypeDbToUi } from '@/lib/donationType';

function donationTypeToUi(t: any): 'financial' | 'material' | 'waiver' {
  return donationTypeDbToUi(t);
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'all';

  const perm = await checkPermission(
    req,
    ResourceType.transactions,
    scope === 'mine' ? AuthorizationType.read_own : AuthorizationType.read_all,
  );
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 403 });
  }

  const donations = await prisma.donation.findMany({
    where: scope === 'mine' ? { userId: currentUser.id } : undefined,
    orderBy: { date: 'desc' },
    include: {
      user: true,
      processor: true,
    },
  });

  // Hinweis: `downloadedAt` wird NICHT beim Listen-Abruf gesetzt.
  // Es soll nur beim Erzeugen/Download der PDF-Spendenquittung (Receipt) befüllt werden.

  const ui = donations.map((d: any) => ({
    id: d.id,
    date: (d.date as Date).toISOString(),
    description: d.description,
    type: donationTypeToUi(d.type),
    amount: Number(d.amount),
    transactionId: d.transactionId,
    userName: d.user ? `${d.user.first_name} ${d.user.last_name}` : undefined,
    processorName: d.processor ? `${d.processor.first_name} ${d.processor.last_name}` : undefined,
    downloadedAt: d.downloadedAt ? (d.downloadedAt as Date).toISOString() : null,
  }));

  return NextResponse.json(ui);
}
