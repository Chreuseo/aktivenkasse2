import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { checkPermission } from '@/services/authService';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
  const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Prüfe globale Berechtigung: read_all auf advances
  const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  const where: any = {};
  if (statusParam) {
    where.state = String(statusParam);
  }

  const advances = await prisma.advances.findMany({
    where,
    orderBy: { date_advance: 'desc' },
    include: { attachment: true, clearingAccount: true, user: true, reviewer: true },
  });

  const res = advances.map(a => ({
    id: a.id,
    amount: Number(a.amount),
    date_advance: (a.date_advance ?? a.date).toISOString(),
    description: a.description,
    state: a.state,
    user: a.user ? `${a.user.first_name} ${a.user.last_name}` : undefined,
    reviewer: a.reviewer ? { first_name: a.reviewer.first_name, last_name: a.reviewer.last_name } : null,
    reason: a.reason || undefined,
    clearingAccountId: a.clearingAccountId || undefined,
    clearingAccountName: a.clearingAccount ? a.clearingAccount.name : undefined,
    attachmentId: a.attachmentId || undefined,
    receiptUrl: a.attachmentId ? `/api/advances/${a.id}/receipt` : undefined,
  }));

  return NextResponse.json({ advances: res });
}
