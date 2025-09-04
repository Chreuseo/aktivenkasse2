import {NextResponse} from 'next/server';
import prisma from '@/lib/prisma';
import {extractUserFromAuthHeader} from '@/lib/serverUtils';
import {clearing_account_roles, getClearingAccountRole} from '@/lib/getUserAuthContext';
import {checkPermission} from '@/services/authService';
import {AuthorizationType, ResourceType} from '@/app/types/authorization';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idParam = url.searchParams.get('clearingAccountId') || url.searchParams.get('id');
  const statusParam = url.searchParams.get('status');

  if (!idParam) return NextResponse.json({ error: 'clearingAccountId wird benötigt' }, { status: 400 });
  const idNum = Number(idParam);
  if (isNaN(idNum) || idNum <= 0) return NextResponse.json({ error: 'Ungültige clearingAccountId' }, { status: 400 });

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
  const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRole = await getClearingAccountRole(idNum, String(sub));

  switch (userRole) {
    case clearing_account_roles.none: {
      const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
      if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
      break;
    }
    case clearing_account_roles.responsible: {
      const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.read_own);
      if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
      break;
    }
    case clearing_account_roles.member: {
      const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
      if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
      break;
    }
  }

  const where: any = { clearingAccountId: idNum };
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
