import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { computeAccount2Negative, normalizeBoolean, isAllowedAttachment, parsePositiveAmount, AccountTypeStr } from '@/lib/validation';
import { extractUserFromAuthHeader, parseMultipartFormDataFromNextApi, resolveAccountId as resolveAccountIdUtil, saveAttachmentFromTempFile } from '@/lib/serverUtils';

export const config = {
  api: {
    bodyParser: false,
  },
};

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId, jwt } = extractUserFromAuthHeader((req.headers['authorization'] as string) || (req.headers['Authorization'] as string));

  if (req.method === 'POST') {
    if (!userId) {
      return res.status(403).json({ error: 'Keine UserId im Token' });
    }
    const { validateUserPermissions } = await import('@/services/authService');
    const perm = await validateUserPermissions({ userId: String(userId), resource: ResourceType.transactions, requiredPermission: AuthorizationType.write_all, jwt });
    if (!perm.allowed) {
      return res.status(403).json({ error: 'Keine Berechtigung für write_all auf transactions' });
    }
    let form;
    try {
      form = await parseMultipartFormDataFromNextApi(req);
    } catch (err: any) {
      console.error('FormData-Parsing-Fehler:', err);
      return res.status(400).json({ error: 'Fehler beim Parsen der Formulardaten', detail: err?.message });
    }
    // Pflichtfelder prüfen
    if (!form.fields.amount || !form.fields.description || !form.fields.account1Type || !form.fields.account1Id) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen', fields: form.fields });
    }

    const {
      amount,
      date_valued,
      description,
      reference,
      account1Type,
      account1Id,
      account2Type,
      account2Id,
      account1Negative,
      // account2Negative wird ignoriert/überschrieben
      costCenterId,
      budgetPlanId,
    } = form.fields as Record<string, any>;
    const file = (form.files?.attachment as any) || null;

    // Attachment-Typ prüfen
    if (file && !isAllowedAttachment(file.mimetype)) {
      return res.status(400).json({ error: 'Dateityp nicht erlaubt (nur Bilder oder PDF)' });
    }

    // Account-Typen validieren
    const a1Type = String(account1Type) as AccountTypeStr;
    const a2Type = account2Type ? (String(account2Type) as AccountTypeStr) : '';
    if (!['user', 'bank', 'clearing_account'].includes(a1Type)) {
      return res.status(400).json({ error: 'Ungültiger account1Type' });
    }
    if (a2Type && !['user', 'bank', 'clearing_account'].includes(a2Type)) {
      return res.status(400).json({ error: 'Ungültiger account2Type' });
    }

    // Budget-/Kostenstellen-Konsistenz: Nur OHNE Gegenkonto erlaubt
    if (a2Type && (budgetPlanId || costCenterId)) {
      return res.status(400).json({ error: 'Budgetplan/Kostenstelle nur ohne Gegenkonto erlaubt' });
    }
    if (costCenterId && !budgetPlanId) {
      return res.status(400).json({ error: 'Kostenstelle ohne Budgetplan nicht erlaubt' });
    }

    const acc1Id = await resolveAccountIdUtil(prisma as any, a1Type, account1Id);
    const acc2Id = account2Id ? await resolveAccountIdUtil(prisma as any, a2Type as string, account2Id) : null;
    if (!acc1Id) {
      return res.status(400).json({ error: 'Account1 konnte nicht aufgelöst werden' });
    }
    if (a2Type && !account2Id) {
      return res.status(400).json({ error: 'account2Id fehlt' });
    }
    if (a2Type && !acc2Id) {
      return res.status(400).json({ error: 'Account2 konnte nicht aufgelöst werden' });
    }

    // Budget-/Kostenstelle prüfen (Existenz/Zuordnung)
    let costCenterIdNum: number | null = null;
    if (!a2Type && budgetPlanId && costCenterId) {
      const cc = await prisma.costCenter.findUnique({ where: { id: Number(costCenterId) } });
      if (!cc) {
        return res.status(400).json({ error: 'Kostenstelle nicht gefunden' });
      }
      if (cc.budget_planId !== Number(budgetPlanId)) {
        return res.status(400).json({ error: 'Kostenstelle gehört nicht zum Budgetplan' });
      }
      costCenterIdNum = cc.id;
    }

    const attachmentId = file ? await saveAttachmentFromTempFile(prisma as any, file) : null;

    const amountNum = parsePositiveAmount(amount);
    if (amountNum === null) {
      return res.status(400).json({ error: 'Ungültiger Betrag' });
    }

    const a1Neg = normalizeBoolean(account1Negative, false);
    const a2Neg = a2Type ? computeAccount2Negative(a1Type, a2Type as AccountTypeStr, a1Neg) : null;

    const amt1 = a1Neg ? -amountNum : amountNum;
    const amt2 = acc2Id ? (a2Neg ? -amountNum : amountNum) : null;

    try {
      const result = await prisma.$transaction(async (p) => {
        // Account 1
        const acc1 = await p.account.findUnique({ where: { id: acc1Id } });
        const bal1 = acc1 ? Number(acc1.balance) : 0;
        const newBal1 = bal1 + amt1;
        const tx1 = await p.transaction.create({
          data: {
            amount: amt1,
            ...(date_valued ? { date_valued: new Date(date_valued) } : {}),
            description,
            ...(reference ? { reference } : {}),
            account: { connect: { id: acc1Id } },
            accountValueAfter: newBal1,
            ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
            // Budget/Kostenstelle nur ohne Gegenkonto setzen
            ...(!a2Type && costCenterIdNum ? { costCenter: { connect: { id: costCenterIdNum } } } : {}),
          },
        });
        await p.account.update({ where: { id: acc1Id }, data: { balance: newBal1 } });

        if (!acc2Id || amt2 === null) {
          return { id: tx1.id };
        }
        // Account 2
        const acc2 = await p.account.findUnique({ where: { id: acc2Id } });
        const bal2 = acc2 ? Number(acc2.balance) : 0;
        const newBal2 = bal2 + amt2;
        const tx2 = await p.transaction.create({
          data: {
            amount: amt2,
            ...(date_valued ? { date_valued: new Date(date_valued) } : {}),
            description,
            ...(reference ? { reference } : {}),
            account: { connect: { id: acc2Id } },
            accountValueAfter: newBal2,
            ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
            // explizit keine Kostenstelle bei Gegenkonto
          },
        });
        await p.account.update({ where: { id: acc2Id }, data: { balance: newBal2 } });

        // wechselseitig verknüpfen
        await p.transaction.update({ where: { id: tx1.id }, data: { counter_transaction: { connect: { id: tx2.id } } } });
        await p.transaction.update({ where: { id: tx2.id }, data: { counter_transaction: { connect: { id: tx1.id } } } });

        return { id: tx1.id };
      });

      return res.status(201).json(result);
    } catch (e: any) {
      console.error('Transaktion fehlgeschlagen', e);
      return res.status(500).json({ error: 'Transaktion fehlgeschlagen' });
    }
  } else if (req.method === 'GET') {
    if (!userId) {
      return res.status(403).json({ error: 'Keine UserId im Token' });
    }
    const { validateUserPermissions } = await import('@/services/authService');
    const perm = await validateUserPermissions({ userId: String(userId), resource: ResourceType.transactions, requiredPermission: AuthorizationType.read_all, jwt });
    if (!perm.allowed) {
      return res.status(403).json({ error: 'Keine Berechtigung für read_all auf transactions' });
    }

    const txs = await prisma.transaction.findMany({
      orderBy: { date_valued: 'desc' },
      include: {
        account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
        counter_transaction: { include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } } },
        attachment: true,
      } as any,
    });

    const ui = txs.map((t) => {
      const other = (t as any).counter_transaction ? inferOtherFromAccount(((t as any).counter_transaction as any).account) : null;
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

    return res.json(ui);
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).end('Method Not Allowed');
  }
}
