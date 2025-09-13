import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { checkPermission } from '@/services/authService';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';

function inferAccountType(acc: any): 'user' | 'bank' | 'clearing_account' | null {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) return 'user';
  if (acc.bankAccounts && acc.bankAccounts.length > 0) return 'bank';
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) return 'clearing_account';
  return null;
}
function inferAccountName(acc: any): string | null {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return `${u.first_name} ${u.last_name}`.trim();
  }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return b.name || b.iban || null;
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return c.name || null;
  }
  return null;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || 250), 1000);

  const bulks = await prisma.transactionBulk.findMany({
    orderBy: [ { date_valued: 'desc' }, { date: 'desc' }, { id: 'desc' } ],
    take: limit,
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
    },
  } as any);

  const list = bulks.map((b: any) => ({
    id: b.id,
    date: (b.date_valued || b.date).toISOString(),
    description: b.description || '',
    hasAttachment: !!b.attachmentId,
    accountType: inferAccountType(b.account),
    accountName: inferAccountName(b.account) || undefined,
  }));

  return NextResponse.json(list);
}

export async function POST() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
}
