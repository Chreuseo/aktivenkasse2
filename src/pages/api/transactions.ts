import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import prisma from '@/lib/prisma';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import { checkPermission } from '@/services/authService';
import fs from 'fs';
import { jwtDecode } from 'jwt-decode';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function parseForm(req: NextApiRequest): Promise<{ fields: Record<string, any>, files: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      // Felder normalisieren
      const normFields: Record<string, any> = {};
      Object.keys(fields).forEach(key => {
        normFields[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
      });
      // Dateien normalisieren
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // Token und UserId aus Header extrahieren
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
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
    // Berechtigungsprüfung: write_all für transactions
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
      form = await parseForm(req);
    } catch (err: any) {
      console.error('FormData-Parsing-Fehler:', err);
      return res.status(400).json({ error: 'Fehler beim Parsen der Formulardaten', detail: err?.message });
    }
    // Pflichtfelder validieren
    if (!form.fields.amount || !form.fields.description || !form.fields.account1Type || !form.fields.account1Id) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen', fields: form.fields });
    }
    // Felder extrahieren
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
    // Accounts auflösen
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
    const acc1Id = await resolveAccountId(account1Type, account1Id);
    const acc2Id = account2Id ? await resolveAccountId(account2Type, account2Id) : null;
    if (!acc1Id) {
      return res.status(400).json({ error: 'Account1 konnte nicht aufgelöst werden' });
    }
    // Attachment speichern (optional)
    let attachmentId: number | null = null;
    if (file && file.filepath) {
      let fileBuffer: Buffer | null = null;
      try {
        fileBuffer = fs.readFileSync(file.filepath);
      } catch {}
      if (fileBuffer) {
        const att = await prisma.attachment.create({
          data: {
            name: file.originalFilename || 'Anhang',
            mimeType: file.mimetype,
            data: fileBuffer,
          },
        });
        attachmentId = att.id;
      }
    }
    // Kontostände für ValueAfter holen
    const acc1 = await prisma.account.findUnique({ where: { id: acc1Id } });
    const acc2 = acc2Id ? await prisma.account.findUnique({ where: { id: acc2Id } }) : null;
    const account1ValueAfter = acc1?.balance ? Number(acc1.balance) : 0;
    const account2ValueAfter = acc2?.balance ? Number(acc2.balance) : 0;
    // Transaktion speichern
    const tx = await prisma.transaction.create({
      data: {
        amount: Number(amount),
        ...(date_valued ? { date_valued: new Date(date_valued) } : {}),
        description,
        ...(reference ? { reference } : {}),
        accountId1: acc1Id,
        account1Negative: String(account1Negative) === 'true',
        account1ValueAfter,
        accountId2: acc2Id,
        account2Negative: acc2Id ? (String(account2Negative) === 'true') : undefined,
        account2ValueAfter: acc2Id ? account2ValueAfter : undefined,
        attachmentId,
        costCenterId: costCenterId ? Number(costCenterId) : undefined,
      },
    });
    return res.status(201).json({ id: tx.id });
  } else if (req.method === 'GET') {
    // Token und UserId aus Header extrahieren
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
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
    const { validateUserPermissions } = await import('@/services/authService');
    const perm = await validateUserPermissions({ userId: String(userId), resource: ResourceType.transactions, requiredPermission: AuthorizationType.read_all, jwt });
    if (!perm.allowed) {
      return res.status(403).json({ error: 'Keine Berechtigung für read_all auf transactions' });
    }
    const txs = await prisma.transaction.findMany({
      orderBy: { date_valued: 'desc' },
      include: { account1: true, account2: true, attachment: true },
    });
    return res.json(txs);
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).end('Method Not Allowed');
  }
}
