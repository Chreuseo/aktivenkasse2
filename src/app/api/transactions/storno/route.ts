import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';
import { checkPermission, extractTokenAndUserId } from '@/services/authService';
import { resolveAccountId } from '@/lib/serverUtils';
import { stornoTransactionWithCounter } from '@/services/transactionService';

type AccountType = 'user' | 'bank' | 'clearing_account';

function isAccountType(v: string): v is AccountType {
  return v === 'user' || v === 'bank' || v === 'clearing_account';
}

export async function GET(req: Request) {
  const { userId } = extractTokenAndUserId(req as any);
  if (!userId) return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 401 });

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: perm.error || 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const accountTypeRaw = String(searchParams.get('accountType') || '');
  const accountEntityId = String(searchParams.get('accountEntityId') || '');
  const limit = Math.min(Number(searchParams.get('limit') || 250), 1000);

  if (!isAccountType(accountTypeRaw)) {
    return NextResponse.json({ error: 'Ungültiger accountType' }, { status: 400 });
  }
  if (!accountEntityId || !Number.isFinite(Number(accountEntityId)) || Number(accountEntityId) <= 0) {
    return NextResponse.json({ error: 'Ungültige accountEntityId' }, { status: 400 });
  }

  const accountId = await resolveAccountId(prisma as any, accountTypeRaw, accountEntityId);
  if (!accountId) {
    return NextResponse.json({ error: 'Konto konnte nicht aufgelöst werden' }, { status: 404 });
  }

  const txs = await prisma.transaction.findMany({
    where: {
      accountId: Number(accountId),
      storno: false,
    },
    orderBy: [{ date_valued: 'desc' }, { date: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      date: true,
      date_valued: true,
      description: true,
      reference: true,
      amount: true,
      attachmentId: true,
      counter_transactionId: true,
      processed: true,
      storno: true,
    },
  } as any);

  return NextResponse.json(
    txs.map((t: any) => ({
      id: Number(t.id),
      date: (t.date_valued || t.date).toISOString(),
      description: String(t.description || ''),
      reference: t.reference || undefined,
      amount: Number(t.amount),
      hasCounter: !!t.counter_transactionId,
      hasAttachment: !!t.attachmentId,
      processed: !!t.processed,
      storno: !!t.storno,
    }))
  );
}

export async function POST(req: Request) {
  const { userId } = extractTokenAndUserId(req as any);
  if (!userId) return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 401 });

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body' }, { status: 400 });
  }

  const transactionId = Number(body?.transactionId);

  if (!transactionId || !Number.isFinite(transactionId) || transactionId <= 0) {
    return NextResponse.json({ error: 'Ungültige transactionId' }, { status: 400 });
  }

  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 403 });
  }

  try {
    const result = await prisma.$transaction(async (p: any) => {
      return stornoTransactionWithCounter(p, {
        transactionId,
        createdById: currentUser.id,
      });
    });
    return NextResponse.json(result);
  } catch (e: any) {
    const msg = String(e?.message || 'Stornierung fehlgeschlagen');
    const status = msg.includes('bereits storniert') || msg.includes('bereits abgerufen') ? 409 : msg.includes('nicht gefunden') ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}


