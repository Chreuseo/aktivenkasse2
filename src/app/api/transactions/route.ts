import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { computeAccount2Negative, normalizeBoolean, isAllowedAttachment, parsePositiveAmount, AccountTypeStr } from '@/lib/validation';
import { extractUserFromAuthHeader, resolveAccountId as resolveAccountIdUtil } from '@/lib/serverUtils';
import { checkPermission} from "@/services/authService";
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';

function inferOtherFromAccount(acc: any): { type: 'user'|'bank'|'clearing_account'; name: string; mail?: string; bank?: string; iban?: string } | null {
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

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

  const perm = await checkPermission( req, ResourceType.transactions, AuthorizationType.write_all );
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }

  // Aktuellen DB-User ermitteln (numeric ID oder Keycloak-ID)
  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 403 });
  }

  // FormData parsen
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err: any) {
    return NextResponse.json({ error: 'Fehler beim Parsen der Formulardaten', detail: err?.message }, { status: 400 });
  }

  const getField = (name: string) => {
    const v = formData.get(name);
    if (v === null) return undefined;
    if (typeof v === 'string') return v;
    // File => return as-is
    return v as any;
  };

  const amount = getField('amount');
  const date_valued = getField('date_valued');
  const description = getField('description');
  const reference = getField('reference');
  const account1Type = getField('account1Type');
  const account1Id = getField('account1Id');
  const account2Type = getField('account2Type');
  const account2Id = getField('account2Id');
  const account1Negative = getField('account1Negative');
  const costCenterId = getField('costCenterId');
  const budgetPlanId = getField('budgetPlanId');
  const file = formData.get('attachment') as File | null;

  // Pflichtfelder prüfen
  if (!amount || !description || !account1Type || !account1Id) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { amount, description, account1Type, account1Id } }, { status: 400 });
  }

  // Attachment-Typ prüfen
  if (file && !isAllowedAttachment((file as any).type)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt (nur Bilder oder PDF)' }, { status: 400 });
  }

  // Account-Typen validieren
  const a1Type = String(account1Type) as AccountTypeStr;
  const a2Type = account2Type ? (String(account2Type) as AccountTypeStr) : '';
  if (!['user', 'bank', 'clearing_account'].includes(a1Type)) {
    return NextResponse.json({ error: 'Ungültiger account1Type' }, { status: 400 });
  }
  if (a2Type && !['user', 'bank', 'clearing_account'].includes(a2Type)) {
    return NextResponse.json({ error: 'Ungültiger account2Type' }, { status: 400 });
  }

  // Budget-/Kostenstellen-Konsistenz
  if (a2Type) {
    if (budgetPlanId || costCenterId) {
      return NextResponse.json({ error: 'Budgetplan/Kostenstelle nur ohne Gegenkonto erlaubt' }, { status: 400 });
    }
  } else {
    if (!budgetPlanId || !costCenterId) {
      return NextResponse.json({ error: 'Kostenstelle ist Pflicht ohne Gegenkonto (Budgetplan und Kostenstelle angeben)' }, { status: 400 });
    }
  }
  if (costCenterId && !budgetPlanId) {
    return NextResponse.json({ error: 'Kostenstelle ohne Budgetplan nicht erlaubt' }, { status: 400 });
  }

  const acc1Id = await resolveAccountIdUtil(prisma as any, a1Type, String(account1Id));
  const acc2Id = account2Id ? await resolveAccountIdUtil(prisma as any, a2Type as string, String(account2Id)) : null;
  if (!acc1Id) {
    return NextResponse.json({ error: 'Account1 konnte nicht aufgelöst werden' }, { status: 400 });
  }
  if (a2Type && !account2Id) {
    return NextResponse.json({ error: 'account2Id fehlt' }, { status: 400 });
  }
  if (a2Type && !acc2Id) {
    return NextResponse.json({ error: 'Account2 konnte nicht aufgelöst werden' }, { status: 400 });
  }

  // Budget-/Kostenstelle prüfen (Existenz/Zuordnung)
  let costCenterIdNum: number | null = null;
  if (!a2Type) {
    const cc = await prisma.costCenter.findUnique({ where: { id: Number(costCenterId) } });
    if (!cc) {
      return NextResponse.json({ error: 'Kostenstelle nicht gefunden' }, { status: 400 });
    }
    if (cc.budget_planId !== Number(budgetPlanId)) {
      return NextResponse.json({ error: 'Kostenstelle gehört nicht zum Budgetplan' }, { status: 400 });
    }
    costCenterIdNum = cc.id;
  }

  const attachmentId = file ? await saveAttachmentFromFormFile(prisma as any, file) : null;

  const amountNum = parsePositiveAmount(amount as string);
  if (amountNum === null) {
    return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
  }

  const a1Neg = normalizeBoolean(account1Negative, false);
  const a2Neg = a2Type ? computeAccount2Negative(a1Type, a2Type as AccountTypeStr, a1Neg) : null;

  const amt1 = a1Neg ? -amountNum : amountNum;
  const amt2 = acc2Id ? (a2Neg ? -amountNum : amountNum) : null;

  try {
    const result = await prisma.$transaction(async (p: any) => {
      const acc1 = await p.account.findUnique({ where: { id: acc1Id } });
      const bal1 = acc1 ? Number(acc1.balance) : 0;
      const newBal1 = bal1 + amt1;
      const tx1 = await p.transaction.create({
        data: {
          amount: amt1,
          ...(date_valued ? { date_valued: new Date(String(date_valued)) } : {}),
          description: String(description),
          ...(reference ? { reference: String(reference) } : {}),
          account: { connect: { id: acc1Id } },
          accountValueAfter: newBal1,
          ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
          ...(!a2Type && costCenterIdNum ? { costCenter: { connect: { id: costCenterIdNum } } } : {}),
          createdBy: { connect: { id: currentUser.id } },
        },
      });
      await p.account.update({ where: { id: acc1Id }, data: { balance: newBal1 } });

      if (!acc2Id || amt2 === null) {
        return { id: tx1.id };
      }

      const acc2 = await p.account.findUnique({ where: { id: acc2Id } });
      const bal2 = acc2 ? Number(acc2.balance) : 0;
      const newBal2 = bal2 + amt2;
      const tx2 = await p.transaction.create({
        data: {
          amount: amt2,
          ...(date_valued ? { date_valued: new Date(String(date_valued)) } : {}),
          description: String(description),
          ...(reference ? { reference: String(reference) } : {}),
          account: { connect: { id: acc2Id } },
          accountValueAfter: newBal2,
          ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
          createdBy: { connect: { id: currentUser.id } },
        },
      });
      await p.account.update({ where: { id: acc2Id }, data: { balance: newBal2 } });

      await p.transaction.update({ where: { id: tx1.id }, data: { counter_transaction: { connect: { id: tx2.id } } } });
      await p.transaction.update({ where: { id: tx2.id }, data: { counter_transaction: { connect: { id: tx1.id } } } });

      return { id: tx1.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    console.error('Transaktion fehlgeschlagen', e);
    return NextResponse.json({ error: 'Transaktion fehlgeschlagen' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

    const perm = await checkPermission( req, ResourceType.transactions, AuthorizationType.read_all );
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für read_all auf transactions' }, { status: 403 });
  }

  const txs = await prisma.transaction.findMany({
    orderBy: { date_valued: 'desc' },
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      counter_transaction: { include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } } },
      attachment: true,
    } as any,
  });

  const ui = txs.map((t: any) => {
    const other = t.counter_transaction ? inferOtherFromAccount(t.counter_transaction.account) : null;
    return {
      id: t.id,
      amount: Number(t.amount),
      date: (t.date_valued || t.date).toISOString(),
      description: t.description,
      reference: t.reference || undefined,
      other,
      attachmentId: (t as any).attachmentId || undefined,
      receiptUrl: (t as any).attachmentId ? `/api/transactions/${t.id}/receipt` : undefined,
    };
  });

  return NextResponse.json(ui);
}
