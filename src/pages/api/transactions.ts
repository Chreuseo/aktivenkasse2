import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import fs from 'fs';
import { jwtDecode } from 'jwt-decode';

export const config = {
  api: {
    bodyParser: false,
  },
};

function extractUserFromToken(authHeader: string | undefined): { token: string | null, userId: string | null, jwt: any } {
  let token: string | null = null;
  let userId: string | null = null;
  let jwt: any = null;
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer (.+)$/);
    if (match) {
      token = match[1];
      try {
        jwt = jwtDecode(token);
        userId = jwt.sub || jwt.userId || jwt.id || null;
      } catch {}
    }
  }
  return { token, userId, jwt };
}

async function checkPermission(userId: string, resource: ResourceType, requiredPermission: AuthorizationType, jwt: any) {
  const { validateUserPermissions } = await import('@/services/authService');
  return validateUserPermissions({ userId: String(userId), resource, requiredPermission, jwt });
}

async function parseForm(req: NextApiRequest): Promise<{ fields: Record<string, any>, files: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const normFields: Record<string, any> = {};
      Object.keys(fields).forEach(key => {
        normFields[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
      });
      const normFiles: Record<string, any> = {};
      Object.keys(files).forEach(key => {
        const file = Array.isArray(files[key]) ? files[key][0] : files[key];
        if (file && file.filepath) {
          normFiles[key] = {
            filename: file.originalFilename || file.newFilename || 'Anhang',
            mimetype: file.mimetype,
            size: file.size,
            filepath: file.filepath,
          };
        }
      });
      resolve({ fields: normFields, files: normFiles });
    });
  });
}

async function resolveAccountId(type: string, id: string) {
  if (!type || !id) return null;
  if (type === 'user') {
    const user = await prisma.user.findUnique({ where: { id: Number(id) }, include: { account: true } });
    return user?.accountId || null;
  }
  if (type === 'bank') {
    const bank = await prisma.bankAccount.findUnique({ where: { id: Number(id) }, include: { account: true } });
    return bank?.accountId || null;
  }
  if (type === 'clearing_account') {
    const ca = await prisma.clearingAccount.findUnique({ where: { id: Number(id) }, include: { account: true } });
    return ca?.accountId || null;
  }
  return null;
}

async function saveAttachment(file: any) {
  if (!file || !file.filepath) return null;
  let fileBuffer: Buffer | null = null;
  try {
    fileBuffer = fs.readFileSync(file.filepath);
  } catch {}
  if (fileBuffer) {
    const att = await prisma.attachment.create({
      data: {
        name: file.filename || 'Anhang',
        mimeType: file.mimetype,
        data: fileBuffer,
      },
    });
    return att.id;
  }
  return null;
}

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
  const { token, userId, jwt } = extractUserFromToken(req.headers['authorization'] as string || req.headers['Authorization'] as string);

  if (req.method === 'POST') {
    if (!userId) {
      return res.status(403).json({ error: 'Keine UserId im Token' });
    }
    const perm = await checkPermission(userId, ResourceType.transactions, AuthorizationType.write_all, jwt);
    if (!perm.allowed) {
      return res.status(403).json({ error: 'Keine Berechtigung für write_all auf transactions' });
    }
    let form;
    try {
      form = await parseForm(req);
    } catch (err: any) {
      console.error('FormData-Parsing-Fehler:', err);
      return res.status(400).json({ error: 'Fehler beim Parsen der Formulardaten', detail: err?.message });
    }
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
      account2Negative,
      costCenterId,
    } = form.fields;
    const file = form.files?.attachment;

    const acc1Id = await resolveAccountId(account1Type, account1Id);
    const acc2Id = account2Id ? await resolveAccountId(account2Type, account2Id) : null;
    if (!acc1Id) {
      return res.status(400).json({ error: 'Account1 konnte nicht aufgelöst werden' });
    }

    const attachmentId = await saveAttachment(file);

    const amountNum = Math.abs(Number(amount));
    if (!isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Ungültiger Betrag' });
    }
    const amt1 = (String(account1Negative) === 'true') ? -amountNum : amountNum;
    const amt2 = acc2Id ? ((String(account2Negative) === 'true') ? -amountNum : amountNum) : null;

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
            ...(costCenterId ? { costCenter: { connect: { id: Number(costCenterId) } } } : {}),
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
            ...(costCenterId ? { costCenter: { connect: { id: Number(costCenterId) } } } : {}),
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
    const perm = await checkPermission(userId, ResourceType.transactions, AuthorizationType.read_all, jwt);
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
