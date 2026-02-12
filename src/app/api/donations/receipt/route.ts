import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission } from '@/services/authService';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
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
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_own);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  if (!from || !to) {
    return NextResponse.json({ error: 'Query-Parameter from und to sind erforderlich (YYYY-MM-DD oder ISO)' }, { status: 400 });
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

  const donations = await prisma.donation.findMany({
    where: {
      userId: currentUser.id,
      date: { gte: from, lte: toInclusive },
    },
    orderBy: { date: 'asc' },
  });

  const rows: DonationReceiptRow[] = donations.map((d: any) => ({
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
      name: `${currentUser.first_name} ${currentUser.last_name}`,
      street: currentUser.street ?? '',
      postalCode: currentUser.postal_code ?? '',
      city: currentUser.city ?? '',
    },
    createdAt: new Date(),
    from,
    to,
    rows,
  });

  const fileName = `Spendenquittung_${currentUser.last_name}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.pdf`;

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
