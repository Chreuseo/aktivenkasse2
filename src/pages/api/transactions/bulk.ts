import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import fs from "fs";
import { jwtDecode } from "jwt-decode";
import { BulkTransactionType } from "@prisma/client";

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

    // Einzugsart-Logik
    // Zeichen der Hauptbuchung (Summe)
    let mainSign = 1; // +
    let bulkTypeEnum: BulkTransactionType = BulkTransactionType.collection;
    if (bulkType === "auszahlung") { mainSign = -1; bulkTypeEnum = BulkTransactionType.payout; }
    if (bulkType === "einzug") { mainSign = 1; bulkTypeEnum = BulkTransactionType.collection; }
    if (bulkType === "einzahlung") { mainSign = 1; bulkTypeEnum = BulkTransactionType.deposit; }

    // Für Einzelzeilen: Zeichen auf Gegenkonto
    function rowAmountSigned(raw: number): number {
      if (bulkType === "einzug") return -Math.abs(raw);      // Einzug: Gegenkonto -
      if (bulkType === "auszahlung") return Math.abs(raw);   // Auszahlung: Gegenkonto +
      if (bulkType === "einzahlung") return Math.abs(raw);   // Einzahlung: Gegenkonto +
      return Math.abs(raw);
    }

    // Einzelbuchungen vorbereiten
    const preparedRows: Array<{ accountId: number, amount: number, description: string, reference?: string, costCenterId?: number }>
      = [];
    let totalAmount = 0;

    for (const row of rows) {
      if (!row.id || !row.amount) continue; // leere Zeilen überspringen
      const accId = await resolveAccountId(row.type, row.id);
      if (!accId) continue;
      let amount = Number(row.amount);
      if (!isFinite(amount) || amount <= 0) continue;
      const signed = rowAmountSigned(amount);
      totalAmount += Math.abs(amount);
      let txDescription = description;
      if (row.description) txDescription += " - " + row.description;
      preparedRows.push({
        accountId: accId,
        amount: signed,
        description: txDescription,
        reference,
        costCenterId: row.costCenterId ? Number(row.costCenterId) : undefined,
      });
    }

    if (totalAmount === 0) {
      return res.status(400).json({ error: "Kein Betrag angegeben" });
    }

    // Attachment speichern
    const attachmentId = await saveAttachment(file);

    try {
      const result = await prisma.$transaction(async (p) => {
        // Hauptbuchung anlegen (Summe, ohne Gegenbuchung)
        const mainAcc = await p.account.findUnique({ where: { id: mainAccountId } });
        const mainBal = mainAcc ? Number(mainAcc.balance) : 0;
        const mainAmt = mainSign * totalAmount;
        const mainNewBal = mainBal + mainAmt;
        const mainTx = await p.transaction.create({
          data: {
            amount: mainAmt,
            date_valued: new Date(date_valued),
            description,
            reference,
            account: { connect: { id: mainAccountId } },
            accountValueAfter: mainNewBal,
            ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
          },
        });
        await p.account.update({ where: { id: mainAccountId }, data: { balance: mainNewBal } });

        // Bulk-Datensatz anlegen und Haupt-Transaktion verknüpfen
        const bulk = await p.transactionBulk.create({
          data: {
            date_valued: new Date(date_valued),
            description,
            reference,
            account: { connect: { id: mainAccountId } },
            ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
            mainTransaction: { connect: { id: mainTx.id } },
            type: bulkTypeEnum,
          },
        });

        // Einzeltransaktionen anlegen, gegenläufig mit Hauptbuchung verknüpfen
        for (const r of preparedRows) {
          const acc = await p.account.findUnique({ where: { id: r.accountId } });
          const bal = acc ? Number(acc.balance) : 0;
          const newBal = bal + r.amount;
          await p.transaction.create({
            data: {
              amount: r.amount,
              date_valued: new Date(date_valued),
              description: r.description,
              reference: r.reference,
              account: { connect: { id: r.accountId } },
              accountValueAfter: newBal,
              ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
              ...(r.costCenterId ? { costCenter: { connect: { id: r.costCenterId } } } : {}),
              transactionBulk: { connect: { id: bulk.id } },
              counter_transaction: { connect: { id: mainTx.id } },
            },
          });
          await p.account.update({ where: { id: r.accountId }, data: { balance: newBal } });
        }

        // Haupt-Transaktion ebenfalls dem Bulk zuordnen (aber ohne Gegenbuchung im Hauptkonto)
        await p.transaction.update({ where: { id: mainTx.id }, data: { transactionBulk: { connect: { id: bulk.id } } } });

        return { id: bulk.id };
      });

      return res.status(201).json(result);
    } catch (e: any) {
      console.error("Sammeltransaktion fehlgeschlagen", e);
      return res.status(500).json({ error: "Sammeltransaktion fehlgeschlagen" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }
}
