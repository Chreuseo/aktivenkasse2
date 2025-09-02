import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import fs from "fs";
import { jwtDecode } from "jwt-decode";

export const config = {
  api: {
    bodyParser: false,
  },
};

function extractUserFromToken(authHeader: string | undefined) {
  let token: string | null = null;
  let userId: string | null = null;
  let jwt: any = null;
  if (authHeader && typeof authHeader === "string") {
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
  const { validateUserPermissions } = await import("@/services/authService");
  return validateUserPermissions({ userId: String(userId), resource, requiredPermission, jwt });
}

async function parseForm(req: NextApiRequest) {
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
            filename: file.originalFilename || file.newFilename || "Anhang",
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
  if (type === "user") {
    const user = await prisma.user.findUnique({ where: { id: Number(id) }, include: { account: true } });
    return user?.accountId || null;
  }
  if (type === "bank") {
    const bank = await prisma.bankAccount.findUnique({ where: { id: Number(id) }, include: { account: true } });
    return bank?.accountId || null;
  }
  if (type === "clearing_account") {
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
        name: file.filename || "Anhang",
        mimeType: file.mimetype,
        data: fileBuffer,
      },
    });
    return att.id;
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token, userId, jwt } = extractUserFromToken(req.headers["authorization"] as string || req.headers["Authorization"] as string);

  if (req.method === "POST") {
    if (!userId) {
      return res.status(403).json({ error: "Keine UserId im Token" });
    }
    const perm = await checkPermission(userId, ResourceType.transactions, AuthorizationType.write_all, jwt);
    if (!perm.allowed) {
      return res.status(403).json({ error: "Keine Berechtigung für write_all auf transactions" });
    }
    let form: any;
    try {
      form = await parseForm(req);
    } catch (err: any) {
      return res.status(400).json({ error: "Fehler beim Parsen der Formulardaten", detail: err?.message });
    }
    const { date_valued, description, reference, bulkType, accountType, accountId } = form.fields;
    const file = form.files?.attachment;
    let rows: any[] = [];
    try {
      rows = JSON.parse(form.fields.rows || "[]");
    } catch {
      return res.status(400).json({ error: "Ungültige Einzelbuchungen" });
    }
    if (!date_valued || !description || !bulkType || !accountType || !accountId) {
      return res.status(400).json({ error: "Pflichtfelder fehlen", fields: form.fields });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "Mindestens eine Einzelbuchung erforderlich" });
    }
    // Hauptkonto auflösen
    const mainAccountId = await resolveAccountId(accountType, accountId);
    if (!mainAccountId) {
      return res.status(400).json({ error: "Hauptkonto konnte nicht aufgelöst werden" });
    }
    // Einzelbuchungen vorbereiten
    let totalAmount = 0;
    const transactionsData: any[] = [];
    let bulkNegative = false;
    let bulkTypeEnum: "collection" | "deposit" | "payout" = "collection";
    for (const row of rows) {
      if (!row.id || !row.amount) continue; // leere Zeilen überspringen
      const accId = await resolveAccountId(row.type, row.id);
      if (!accId) continue;
      let amount = Number(row.amount);
      if (isNaN(amount) || amount <= 0) continue;
      totalAmount += amount;
      let txDescription = description;
      if (row.description) txDescription += " - " + row.description;
      // Einzugsart-Logik
      let account1Negative = false;
      if (bulkType === "einzug") {
        account1Negative = true;
        bulkNegative = false;
        bulkTypeEnum = "collection";
      } else if (bulkType === "einzahlung") {
        account1Negative = false;
        bulkNegative = false;
        bulkTypeEnum = "deposit";
      } else if (bulkType === "auszahlung") {
        account1Negative = false;
        bulkNegative = true;
        bulkTypeEnum = "payout";
      }
      transactionsData.push({
        amount,
        date_valued: new Date(date_valued),
        description: txDescription,
        reference,
        accountId1: accId,
        account1Negative,
        account1ValueAfter: 0, // wird nachher gesetzt
        accountId2: mainAccountId,
        account2Negative: bulkNegative,
        account2ValueAfter: 0, // wird nachher gesetzt
        budgetPlanId: row.budgetPlanId ? Number(row.budgetPlanId) : undefined,
        costCenterId: row.costCenterId ? Number(row.costCenterId) : undefined,
      });
    }
    if (totalAmount === 0) {
      return res.status(400).json({ error: "Kein Betrag angegeben" });
    }
    // Attachment speichern
    const attachmentId = await saveAttachment(file);
    // Einzelbuchungen speichern und Kontostände aktualisieren
    const transactionIds: number[] = [];
    for (const tx of transactionsData) {
      // Kontostände aktualisieren
      await prisma.account.update({
        where: { id: tx.accountId1 },
        data: {
          balance: tx.account1Negative ? { decrement: tx.amount } : { increment: tx.amount },
        },
      });
      await prisma.account.update({
        where: { id: tx.accountId2 },
        data: {
          balance: tx.account2Negative ? { decrement: tx.amount } : { increment: tx.amount },
        },
      });
      // Kontostände nach Buchung abfragen
      const acc1After = await prisma.account.findUnique({ where: { id: tx.accountId1 } });
      const acc2After = await prisma.account.findUnique({ where: { id: tx.accountId2 } });
      const account1ValueAfter = acc1After?.balance ? Number(acc1After.balance) : 0;
      const account2ValueAfter = acc2After?.balance ? Number(acc2After.balance) : 0;
      const transaction = await prisma.transaction.create({
        data: {
          amount: tx.amount,
          date_valued: tx.date_valued,
          description: tx.description,
          reference: tx.reference,
          accountId1: tx.accountId1,
          account1Negative: tx.account1Negative,
          account1ValueAfter,
          accountId2: tx.accountId2,
          account2Negative: tx.account2Negative,
          account2ValueAfter,
          attachmentId,
          costCenterId: tx.costCenterId,
        },
      });
      transactionIds.push(transaction.id);
    }
    // Bulk-Konto aktualisieren
    await prisma.account.update({
      where: { id: mainAccountId },
      data: {
        balance: bulkNegative ? { decrement: totalAmount } : { increment: totalAmount },
      },
    });
    // Kontostand nach allen Buchungen holen
    const mainAccountAfter = await prisma.account.findUnique({ where: { id: mainAccountId } });
    // Bulk-Transaktion anlegen
    const bulkAmount = bulkNegative ? -totalAmount : totalAmount;
    const bulkTx = await prisma.transactionBulk.create({
      data: {
        date_valued: new Date(date_valued),
        amount: bulkAmount,
        balanceAfter: mainAccountAfter?.balance ? Number(mainAccountAfter.balance) : 0,
        description,
        reference,
        accountId: mainAccountId,
        attachmentId,
        type: bulkTypeEnum,
      },
    });
    // Einzelbuchungen mit Bulk-Id aktualisieren
    await prisma.transaction.updateMany({
      where: { id: { in: transactionIds } },
      data: { transactionBulkId: bulkTx.id },
    });
    return res.status(201).json({ id: bulkTx.id });
  } else {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }
}
