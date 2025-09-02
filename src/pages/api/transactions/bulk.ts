import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { BulkTransactionType } from "@prisma/client";
import { isAllowedAttachment, isAllowedMainAccountForBulk, isAllowedRowTypeForBulk, parsePositiveAmount } from "@/lib/validation";
import { extractUserFromAuthHeader, parseMultipartFormDataFromNextApi, resolveAccountId as resolveAccountIdUtil, saveAttachmentFromTempFile } from "@/lib/serverUtils";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId, jwt } = extractUserFromAuthHeader((req.headers["authorization"] as string) || (req.headers["Authorization"] as string));

  if (req.method === "POST") {
    if (!userId) {
      return res.status(403).json({ error: "Keine UserId im Token" });
    }
    const { validateUserPermissions } = await import("@/services/authService");
    const perm = await validateUserPermissions({ userId: String(userId), resource: ResourceType.transactions, requiredPermission: AuthorizationType.write_all, jwt });
    if (!perm.allowed) {
      return res.status(403).json({ error: "Keine Berechtigung für write_all auf transactions" });
    }
    let form: any;
    try {
      form = await parseMultipartFormDataFromNextApi(req);
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
    const mainAccountId = await resolveAccountIdUtil(prisma as any, accountType, accountId);
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
    type PreparedRow = { accountId?: number, amount: number, description: string, reference?: string, costCenterId?: number };
    const preparedRows: PreparedRow[] = [];
    const costCenterRows: PreparedRow[] = [];
    let totalAmount = 0; // Summe nur derjenigen Zeilen, die ein Gegenkonto haben

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

      // Budget/Kostenstelle Konsistenz pro Zeile (nur ohne Auswahl erlaubt)
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
        // Wenn keine Auswahl, aber Kostenstelle angegeben -> als Kostenstellen-Zeile behandeln
        if (rowCostCenterId) {
          const signed = mainSign * Math.abs(amountNum); // Kostenstellen-Buchungen spiegeln nun das Vorzeichen der Sammelbuchung
          let txDescription = description;
          if (row.description) txDescription += " - " + row.description;
          costCenterRows.push({
            amount: signed,
            description: txDescription,
            reference,
            costCenterId: rowCostCenterId,
          });
          // NICHT in die Gesamt-Summe aufnehmen
          continue;
        }
        // Ohne Auswahlkonto und ohne Kostenstelle nicht buchen (Frontend erlaubt leere Zeilen)
        continue;
      }

      const accId = await resolveAccountIdUtil(prisma as any, row.type, row.id);
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
      });
    }

    if (preparedRows.length === 0 && costCenterRows.length === 0) {
      return res.status(400).json({ error: "Mindestens eine gültige Einzelbuchung erforderlich" });
    }

    // Buchungen in DB schreiben
    const attachmentId = await saveAttachmentFromTempFile(prisma as any, file);

    try {
      const result = await prisma.$transaction(async (p) => {
        // Hauptbuchung anlegen (Summe, ohne Gegenbuchungen der Kostenstellen)
        const mainAcc = await p.account.findUnique({ where: { id: mainAccountId } });
        const mainBal = mainAcc ? Number(mainAcc.balance) : 0;
        const mainAmt = mainSign * totalAmount; // Kostenstellen sind hier ausgeschlossen
        let mainNewBal = mainBal + mainAmt;

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
              transactionBulk: { connect: { id: bulk.id } },
              counter_transaction: { connect: { id: mainTx.id } },
            },
          });
          await p.account.update({ where: { id: r.accountId }, data: { balance: newBal } });

          // we also link mainTx -> counter via counter_transaction relation is symmetric in schema; ensure mainTx remains main
        }

        // Kostenstellen-Zeilen als eigene Einzelbuchungen anlegen (mit Kostenstelle)
        if (costCenterRows.length > 0) {
          for (const ccRow of costCenterRows) {
            // Buchung auf Hauptkonto in der gleichen Richtung wie mainTx (mainSign)
            const acct = await p.account.findUnique({ where: { id: mainAccountId } });
            const accBal = acct ? Number(acct.balance) : 0;
            const newMainBal2 = accBal + ccRow.amount;
            await p.transaction.create({
              data: {
                amount: ccRow.amount,
                date_valued: new Date(date_valued),
                description: ccRow.description,
                reference: ccRow.reference,
                account: { connect: { id: mainAccountId } },
                accountValueAfter: newMainBal2,
                ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
                costCenter: { connect: { id: ccRow.costCenterId } },
                transactionBulk: { connect: { id: bulk.id } },
                // keine counter_transaction: separate Einzelbuchung
              },
            });
            await p.account.update({ where: { id: mainAccountId }, data: { balance: newMainBal2 } });
          }
        }

        // Haupt-Transaktion dem Bulk zuordnen (falls nicht automatisch gesetzt)
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
