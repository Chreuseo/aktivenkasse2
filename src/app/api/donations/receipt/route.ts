import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission, getAuthContext } from '@/services/authService';
import { generateDonationReceiptPdf, type DonationReceiptRow } from '@/lib/pdf';
import { donationTypeDbToUi } from '@/lib/donationType';

export const runtime = 'nodejs';

function donationTypeToUi(t: any): 'financial' | 'material' | 'waiver' {
  return donationTypeDbToUi(t);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseDateParam(v: string | null): Date | null {
  if (!v) return null;
  // akzeptiere YYYY-MM-DD oder ISO
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  const { userId } = await getAuthContext(req);
  if (!userId) return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 401 });

  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  const requestedUserIdRaw = url.searchParams.get('userId');
  if (!from || !to) {
    return NextResponse.json({ error: 'Query-Parameter from und to sind erforderlich (YYYY-MM-DD oder ISO)' }, { status: 400 });
  }

  let requestedUserId: number | null = null;
  if (requestedUserIdRaw) {
    const parsed = Number(requestedUserIdRaw);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: 'Query-Parameter userId muss numerisch sein' }, { status: 400 });
    }
    requestedUserId = parsed;
  }

  // to als inklusives Enddatum behandeln: bis Tagesende
  const toInclusive = new Date(to);
  toInclusive.setHours(23, 59, 59, 999);

  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 403 });
  }

  const targetUserId = requestedUserId ?? currentUser.id;
  const requiredAuthorization =
    targetUserId === currentUser.id ? AuthorizationType.read_own : AuthorizationType.read_all;

  const perm = await checkPermission(req, ResourceType.transactions, requiredAuthorization);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const targetUser =
    targetUserId === currentUser.id ? currentUser : await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: 'Ziel-Benutzer nicht gefunden' }, { status: 404 });
  }

  const donations = await prisma.donation.findMany({
    where: {
      userId: targetUser.id,
      date: { gte: from, lte: toInclusive },
    },
    orderBy: { date: 'asc' },
  });

  // Beim ersten PDF-Abruf: downloadedAt einmalig setzen (nur wenn noch NULL).
  // Batch-Update ist idempotent und vermeidet N+1.
  if (donations.length > 0) {
    const ids = donations.map((d: any) => d.id);
    const now = new Date();

    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await prisma.donation.updateMany({
        where: {
          id: { in: chunk },
          downloadedAt: null,
        },
        data: {
          downloadedAt: now,
        },
      });
    }
  }

  const rows: DonationReceiptRow[] = donations.map((d: any) => ({
    id: d.id,
    date: (d.date as Date).toISOString(),
    description: d.description,
    type: donationTypeToUi(d.type),
    amount: Number(d.amount),
  }));

  const pdf = await generateDonationReceiptPdf({
    corporation: requireEnv('CUSTOM_CORPORATION'),
    address: requireEnv('CUSTOM_ADDRESS'),
    donationHeader: requireEnv('DONATION_HEADER'),
    donationEntry: requireEnv('DONATION_ENTRY'),
    donationFooter: requireEnv('DONATION_FOOTER'),
    signatory1Role: requireEnv('DONATION_SIGNATORY_1'),
    signatory1Name: requireEnv('DONATION_SIGNATORY_NAME_1'),
    signatory2Role: requireEnv('DONATION_SIGNATORY_2'),
    signatory2Name: requireEnv('DONATION_SIGNATORY_NAME_2'),
    signatureFooter: requireEnv('DONATION_SIGNATURE_FOOTER'),
    user: {
      name: `${targetUser.first_name} ${targetUser.last_name}`,
      street: targetUser.street ?? '',
      postalCode: targetUser.postal_code ?? '',
      city: targetUser.city ?? '',
    },
    createdAt: new Date(),
    from,
    to,
    rows,
  });

  const fileName = `Spendenquittung_${targetUser.last_name}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.pdf`;

  // Buffer ist nicht direkt als BodyInit typisiert -> als Uint8Array/ArrayBuffer liefern
  const body = new Uint8Array(pdf);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
