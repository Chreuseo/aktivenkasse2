import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

function inferAccountInfo(acc: any): { type: 'user'|'bank'|'clearing_account'; name: string; mail?: string; bank?: string; iban?: string } | null {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return { type: 'user', name: `${u.first_name} ${u.last_name}`, mail: u.mail };
  }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return { type: 'bank', name: b.name, bank: b.bank, iban: b.iban };
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return { type: 'clearing_account', name: c.name };
  }
  return null;
}

function mapTypeToLabel(t: string | null | undefined): string {
  switch ((t || '').toLowerCase()) {
    case 'payout': return 'Auszahlung';
    case 'collection': return 'Einzug';
    case 'deposit': return 'Einzahlung';
    default: return t || '';
  }
}

export async function GET(req: NextRequest, context: any) {
  const { id } = context.params;

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) {
    const status = perm.error === "Kein Token" || perm.error === "Keine UserId im Token" ? 401 : 403;
    return NextResponse.json({ error: perm.error || 'Forbidden' }, { status });
  }

  const bulkId = Number(id);
  if (!bulkId || isNaN(bulkId)) {
    return NextResponse.json({ error: 'Ungültige Sammeltransaktions-ID' }, { status: 400 });
  }

  const bulk = await prisma.transactionBulk.findUnique({
    where: { id: bulkId },
    include: {
      attachment: true,
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      mainTransaction: true,
      transactions: {
        include: {
          account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
          costCenter: { include: { budget_plan: true } },
          attachment: true,
        },
        orderBy: { date: 'asc' },
      },
    },
  } as any);

  if (!bulk) {
    return NextResponse.json({ error: 'Sammeltransaktion nicht gefunden' }, { status: 404 });
  }

  const accountInfo = inferAccountInfo((bulk as any).account);
  const rows = (bulk as any).transactions.map((t: any) => {
    const acc = inferAccountInfo(t.account);
    const costCenterLabel = t.costCenter && t.costCenter.budget_plan ? `${t.costCenter.budget_plan.name} - ${t.costCenter.name}` : undefined;
    return {
      id: t.id,
      account: acc,
      amount: Number(t.amount),
      description: t.description,
      costCenterLabel,
    };
  });

  const result = {
    id: bulk.id,
    date: (bulk.date_valued || bulk.date).toISOString(),
    type: mapTypeToLabel((bulk as any).type),
    description: bulk.description,
    reference: bulk.reference || undefined,
    account: accountInfo,
    attachmentId: (bulk as any).attachmentId || undefined,
    attachmentUrl: (bulk as any).attachmentId ? `/api/attachments/${(bulk as any).attachmentId}/download` : undefined,
    rows,
  };

  return NextResponse.json(result);
}

export async function POST() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
}
