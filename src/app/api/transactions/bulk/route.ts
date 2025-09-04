import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { BulkTransactionType } from '@prisma/client';
import { isAllowedAttachment, isAllowedMainAccountForBulk, isAllowedRowTypeForBulk, parsePositiveAmount } from '@/lib/validation';
import { extractUserFromAuthHeader, resolveAccountId as resolveAccountIdUtil } from '@/lib/serverUtils';
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission} from "@/services/authService";
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';

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
    return v as any; // File
  };

  const date_valued = getField('date_valued');
  const description = getField('description');
  const reference = getField('reference');
  const bulkType = getField('bulkType');
  const accountType = getField('accountType');
  const accountId = getField('accountId');
  const file = formData.get('attachment') as File | null;
  const rowsRaw = getField('rows');

  if (!date_valued || !description || !bulkType || !accountType || !accountId) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { date_valued, description, bulkType, accountType, accountId } }, { status: 400 });
  }

  // Attachment-Typ prüfen
  if (file && !isAllowedAttachment((file as any).type)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt (nur Bilder oder PDF)' }, { status: 400 });
  }

  // BulkType bestimmen
  const bulkTypeLower = String(bulkType).toLowerCase();
  let bulkTypeEnum: BulkTransactionType | null = null;
  if (bulkTypeLower === 'auszahlung') bulkTypeEnum = BulkTransactionType.payout;
  if (bulkTypeLower === 'einzug') bulkTypeEnum = BulkTransactionType.collection;
  if (bulkTypeLower === 'einzahlung') bulkTypeEnum = BulkTransactionType.deposit;
  if (!bulkTypeEnum) {
    return NextResponse.json({ error: 'Ungültige Einzugsart' }, { status: 400 });
  }

  if (!isAllowedMainAccountForBulk(bulkTypeLower as any, accountType)) {
    return NextResponse.json({ error: 'Auswahltyp für Hauptkonto passt nicht zur Einzugsart' }, { status: 400 });
  }

  // Hauptkonto auflösen
  const mainAccountId = await resolveAccountIdUtil(prisma as any, String(accountType), String(accountId));
  if (!mainAccountId) {
    return NextResponse.json({ error: 'Hauptkonto konnte nicht aufgelöst werden' }, { status: 400 });
  }

  // Parse rows
  let rows: any[] = [];
  try {
    rows = JSON.parse(String(rowsRaw || '[]'));
  } catch {
    return NextResponse.json({ error: 'Ungültige Einzelbuchungen' }, { status: 400 });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Mindestens eine Einzelbuchung erforderlich' }, { status: 400 });
  }

  // Main sign
  let mainSign = 1;
  if (bulkTypeLower === 'auszahlung') mainSign = -1;
  if (bulkTypeLower === 'einzug') mainSign = 1;
  if (bulkTypeLower === 'einzahlung') mainSign = 1;

  function rowAmountSigned(raw: number): number {
    if (bulkTypeLower === 'einzug') return -Math.abs(raw);
    if (bulkTypeLower === 'auszahlung') return Math.abs(raw);
    if (bulkTypeLower === 'einzahlung') return Math.abs(raw);
    return Math.abs(raw);
  }

  type PreparedRow = { accountId?: number, amount: number, description: string, reference?: string, costCenterId?: number };
  const preparedRows: PreparedRow[] = [];
  const costCenterRows: PreparedRow[] = [];
  let totalAmount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idxInfo = `Zeile ${i + 1}`;
    if (!isAllowedRowTypeForBulk(row.type)) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Typ (erlaubt: Nutzer, Verrechnungskonto)` }, { status: 400 });
    }
    const amountNum = parsePositiveAmount(row.amount);
    if (amountNum === null) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Betrag` }, { status: 400 });
    }

    if (row.id && (row.budgetPlanId || row.costCenterId)) {
      return NextResponse.json({ error: `${idxInfo}: Budgetplan/Kostenstelle nicht erlaubt, wenn eine Auswahl getroffen wurde` }, { status: 400 });
    }
    if (row.costCenterId && !row.budgetPlanId) {
      return NextResponse.json({ error: `${idxInfo}: Kostenstelle ohne Budgetplan nicht erlaubt` }, { status: 400 });
    }
    let rowCostCenterId: number | undefined = undefined;
    if (row.budgetPlanId && row.costCenterId) {
      const cc = await prisma.costCenter.findUnique({ where: { id: Number(row.costCenterId) }, include: { budget_plan: { select: { id: true, state: true } } } as any });
      if (!cc) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle nicht gefunden` }, { status: 400 });
      }
      if (cc.budget_planId !== Number(row.budgetPlanId)) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle gehört nicht zum Budgetplan` }, { status: 400 });
      }
      if (!cc.budget_plan || cc.budget_plan.state !== 'active') {
        return NextResponse.json({ error: `${idxInfo}: Budgetplan ist nicht aktiv` }, { status: 400 });
      }
      rowCostCenterId = cc.id;
    }

    if (!row.id) {
      if (!rowCostCenterId) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle ist Pflicht ohne Auswahl (Budgetplan und Kostenstelle angeben)` }, { status: 400 });
      }
      const signed = mainSign * Math.abs(amountNum);
      let txDescription = String(description);
      if (row.description) txDescription += ' - ' + row.description;
      costCenterRows.push({ amount: signed, description: txDescription, reference: String(reference || ''), costCenterId: rowCostCenterId });
      continue;
    }

    const accId = await resolveAccountIdUtil(prisma as any, row.type, row.id);
    if (!accId) {
      return NextResponse.json({ error: `${idxInfo}: Konto konnte nicht aufgelöst werden` }, { status: 400 });
    }

    const signed = rowAmountSigned(amountNum);
    totalAmount += Math.abs(amountNum);
    let txDescription = String(description);
    if (row.description) txDescription += ' - ' + row.description;
    preparedRows.push({ accountId: accId, amount: signed, description: txDescription, reference: String(reference || '') });
  }

  if (preparedRows.length === 0 && costCenterRows.length === 0) {
    return NextResponse.json({ error: 'Mindestens eine gültige Einzelbuchung erforderlich' }, { status: 400 });
  }

  const attachmentId = await saveAttachmentFromFormFile(prisma as any, file);

  try {
    const result = await prisma.$transaction(async (p: any) => {
      const mainAcc = await p.account.findUnique({ where: { id: mainAccountId } });
      const mainBal = mainAcc ? Number(mainAcc.balance) : 0;
      const mainAmt = mainSign * totalAmount;
      const mainNewBal = mainBal + mainAmt;

      const mainTx = await p.transaction.create({
        data: {
          amount: mainAmt,
          date_valued: new Date(String(date_valued)),
          description: String(description),
          reference: reference ? String(reference) : undefined,
          account: { connect: { id: mainAccountId } },
          accountValueAfter: mainNewBal,
          ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
          createdBy: { connect: { id: currentUser.id } },
        },
      });
      await p.account.update({ where: { id: mainAccountId }, data: { balance: mainNewBal } });

      const bulk = await p.transactionBulk.create({
        data: {
          date_valued: new Date(String(date_valued)),
          description: String(description),
          reference: reference ? String(reference) : undefined,
          account: { connect: { id: mainAccountId } },
          ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
          mainTransaction: { connect: { id: mainTx.id } },
          type: bulkTypeEnum,
        },
      });

      for (const r of preparedRows) {
        const acc = await p.account.findUnique({ where: { id: r.accountId } });
        const bal = acc ? Number(acc.balance) : 0;
        const newBal = bal + r.amount;
        await p.transaction.create({
          data: {
            amount: r.amount,
            date_valued: new Date(String(date_valued)),
            description: r.description,
            reference: r.reference,
            account: { connect: { id: r.accountId } },
            accountValueAfter: newBal,
            ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
            transactionBulk: { connect: { id: bulk.id } },
            counter_transaction: { connect: { id: mainTx.id } },
            createdBy: { connect: { id: currentUser.id } },
          },
        });
        await p.account.update({ where: { id: r.accountId }, data: { balance: newBal } });
      }

      if (costCenterRows.length > 0) {
        for (const ccRow of costCenterRows) {
          const acct = await p.account.findUnique({ where: { id: mainAccountId } });
          const accBal = acct ? Number(acct.balance) : 0;
          const newMainBal2 = accBal + ccRow.amount;
          await p.transaction.create({
            data: {
              amount: ccRow.amount,
              date_valued: new Date(String(date_valued)),
              description: ccRow.description,
              reference: ccRow.reference,
              account: { connect: { id: mainAccountId } },
              accountValueAfter: newMainBal2,
              ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
              costCenter: { connect: { id: ccRow.costCenterId } },
              transactionBulk: { connect: { id: bulk.id } },
              createdBy: { connect: { id: currentUser.id } },
            },
          });
          await p.account.update({ where: { id: mainAccountId }, data: { balance: newMainBal2 } });
        }
      }

      await p.transaction.update({ where: { id: mainTx.id }, data: { transactionBulk: { connect: { id: bulk.id } } } });

      return { id: bulk.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    console.error('Sammeltransaktion fehlgeschlagen', e);
    return NextResponse.json({ error: 'Sammeltransaktion fehlgeschlagen' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
