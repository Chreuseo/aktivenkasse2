import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';

export async function GET(req: Request) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
    const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
    const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
    if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { keycloak_id: String(sub) } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const advances = await prisma.advances.findMany({
        where: { user: { accountId: user.accountId } },
        orderBy: { date_advance: 'desc' },
        select: {
            id: true,
            date_advance: true,
            description: true,
            amount: true,
            state: true,
            attachmentId: true,
            clearingAccount: { select: { id: true, name: true } },
            reviewer: { select: { first_name: true, last_name: true } },
            userId: true,
            // include reason for the UI column
            reason: true,
        },
    });

    const items = advances.map((a: any) => ({
        id: a.id,
        date_advance: a.date_advance.toISOString(),
        description: a.description,
        amount: a.amount != null ? String(a.amount) : "0",
        state: a.state,
        attachmentId: a.attachmentId,
        clearingAccount: a.clearingAccount ? { id: a.clearingAccount.id, name: a.clearingAccount.name } : null,
        reviewer: a.reviewer ? { first_name: a.reviewer.first_name, last_name: a.reviewer.last_name } : null,
        canCancel: a.state === 'open' && a.userId === user.id,
        receiptUrl: a.attachmentId ? `/api/advances/${a.id}/receipt` : undefined,
        // pass through reason (may be null)
        reason: a.reason ?? undefined,
    }));

    return NextResponse.json({ items });
}
