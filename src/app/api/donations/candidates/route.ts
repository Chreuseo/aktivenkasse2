import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission } from '@/services/authService';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';

function toBool(v: string | null): boolean {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const url = new URL(req.url);
  const negativeOnly = toBool(url.searchParams.get('negative'));

  const txs = await prisma.transaction.findMany({
    where: {
      donations: { none: {} },
      // Robust: explizit nur Transaktionen mit gesetzter Kostenstelle und Donation-Flag
      costCenterId: { not: null },
      costCenter: { is_donation: true },
      // nur Transaktionen in der Vergangenheit
      processed: true,
      account: {
        users: { some: {} },
        balance: negativeOnly ? { lt: 0 } : { gte: 0 },
      },
    },
    orderBy: { date_valued: 'desc' },
    include: {
      account: { include: { users: true } },
      costCenter: { include: { budget_plan: true } },
    },
  });

  const ui = txs
    .map((t: any) => {
      const user = t.account?.users?.[0];
      if (!user) return null;

      const costCenterLabel = t.costCenter && t.costCenter.budget_plan
        ? `${t.costCenter.budget_plan.name} - ${t.costCenter.name}`
        : (t.costCenter?.name ?? undefined);

      return {
        transactionId: t.id,
        userId: user.id,
        userName: `${user.first_name} ${user.last_name}`,
        date: ((t.date_valued || t.date) as Date).toISOString(),
        amount: Math.abs(Number(t.amount)),
        balance: Number(t.account.balance),
        description: t.description,
        costCenterId: t.costCenterId ?? (t.costCenter ? t.costCenter.id : undefined),
        costCenterLabel,
      };
    })
    .filter(Boolean);

  return NextResponse.json(ui);
}
