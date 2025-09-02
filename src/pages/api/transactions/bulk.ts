import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import fs from "fs";
import { jwtDecode } from "jwt-decode";
import { BulkTransactionType } from "@prisma/client";
import { isAllowedAttachment, isAllowedMainAccountForBulk, isAllowedRowTypeForBulk, parsePositiveAmount } from "@/lib/validation";

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
        userId = (jwt as any).sub || (jwt as any).userId || (jwt as any).id || null;
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
        normFields[key] = Array.isArray(fields[key]) ? (fields as any)[key][0] : (fields as any)[key];
      });
      const normFiles: Record<string, any> = {};
      Object.keys(files).forEach(key => {
        const file: any = Array.isArray(files[key]) ? (files as any)[key][0] : (files as any)[key];
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
  const { token, userId, jwt } = extractUserFromToken((req.headers["authorization"] as string) || (req.headers["Authorization"] as string));

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

    // Attachment-Typ prüfen
    if (file && !isAllowedAttachment(file.mimetype)) {
      return res.status(400).json({ error: "Dateityp nicht erlaubt (nur Bilder oder PDF)" });
    }

    // Einzugsart prüfen und erlaubte Hauptkontotypen sicherstellen
    const bulkTypeLower = String(bulkType).toLowerCase();
    let bulkTypeEnum: BulkTransactionType | null = null;
    if (bulkTypeLower === "auszahlung") bulkTypeEnum = BulkTransactionType.payout;
    if (bulkTypeLower === "einzug") bulkTypeEnum = BulkTransactionType.collection;
    if (bulkTypeLower === "einzahlung") bulkTypeEnum = BulkTransactionType.deposit;
    if (!bulkTypeEnum) {
      return res.status(400).json({ error: "Ungültige Einzugsart" });
    }
    if (!isAllowedMainAccountForBulk(bulkTypeLower as any, accountType)) {
      return res.status(400).json({ error: "Auswahltyp für Hauptkonto passt nicht zur Einzugsart" });
    }

    // Hauptkonto auflösen
    const mainAccountId = await resolveAccountId(accountType, accountId);
    if (!mainAccountId) {
      return res.status(400).json({ error: "Hauptkonto konnte nicht aufgelöst werden" });
    }

    // Zeichen der Hauptbuchung (Summe)
    let mainSign = 1; // +
    if (bulkTypeLower === "auszahlung") { mainSign = -1; }
    if (bulkTypeLower === "einzug") { mainSign = 1; }
    if (bulkTypeLower === "einzahlung") { mainSign = 1; }

    // Für Einzelzeilen: Zeichen auf Gegenkonto
    function rowAmountSigned(raw: number): number {
      if (bulkTypeLower === "einzug") return -Math.abs(raw);      // Einzug: Gegenkonto -
      if (bulkTypeLower === "auszahlung") return Math.abs(raw);   // Auszahlung: Gegenkonto +
      if (bulkTypeLower === "einzahlung") return Math.abs(raw);   // Einzahlung: Gegenkonto +
      return Math.abs(raw);
    }

    // Einzelbuchungen vorbereiten mit Validierung
    type PreparedRow = { accountId: number, amount: number, description: string, reference?: string, costCenterId?: number };
    const preparedRows: PreparedRow[] = [];
    let totalAmount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const idxInfo = `Zeile ${i + 1}`;
      // Typ validieren
      if (!isAllowedRowTypeForBulk(row.type)) {
        return res.status(400).json({ error: `${idxInfo}: Ungültiger Typ (erlaubt: Nutzer, Verrechnungskonto)` });
      }
      // Betrag prüfen
      const amountNum = parsePositiveAmount(row.amount);
      if (amountNum === null) {
        return res.status(400).json({ error: `${idxInfo}: Ungültiger Betrag` });
      }

      // Budget/Kostenstelle Konsistenz pro Zeile
      if (row.id && (row.budgetPlanId || row.costCenterId)) {
        return res.status(400).json({ error: `${idxInfo}: Budgetplan/Kostenstelle nicht erlaubt, wenn eine Auswahl getroffen wurde` });
      }
      if (row.costCenterId && !row.budgetPlanId) {
        return res.status(400).json({ error: `${idxInfo}: Kostenstelle ohne Budgetplan nicht erlaubt` });
      }
      let rowCostCenterId: number | undefined = undefined;
      if (row.budgetPlanId && row.costCenterId) {
        const cc = await prisma.costCenter.findUnique({ where: { id: Number(row.costCenterId) } });
        if (!cc) {
          return res.status(400).json({ error: `${idxInfo}: Kostenstelle nicht gefunden` });
        }
        if (cc.budget_planId !== Number(row.budgetPlanId)) {
          return res.status(400).json({ error: `${idxInfo}: Kostenstelle gehört nicht zum Budgetplan` });
        }
        rowCostCenterId = cc.id;
      }

      if (!row.id) {
        // Ohne Auswahlkonto akzeptieren wir die Zeile nicht als Transaktion, sie würde sonst ins Leere laufen
        // (Frontend lässt leere Zeilen zu; wir erzwingen hier, dass nur gültige Zeilen gezählt werden)
        continue;
      }

      const accId = await resolveAccountId(row.type, row.id);
      if (!accId) {
        return res.status(400).json({ error: `${idxInfo}: Konto konnte nicht aufgelöst werden` });
      }

      const signed = rowAmountSigned(amountNum);
      totalAmount += Math.abs(amountNum);
      let txDescription = description;
      if (row.description) txDescription += " - " + row.description;
      preparedRows.push({
        accountId: accId,
        amount: signed,
        description: txDescription,
        reference,
        ...(rowCostCenterId ? { costCenterId: rowCostCenterId } : {}),
      });
    }

    if (preparedRows.length === 0) {
      return res.status(400).json({ error: "Mindestens eine gültige Einzelbuchung erforderlich" });
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
