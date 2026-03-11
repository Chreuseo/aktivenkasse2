import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { BulkTransactionType } from '@prisma/client';
import { isAllowedAttachment, parsePositiveAmount, roundToTwoDecimals } from '@/lib/validation';
import { resolveAccountId as resolveAccountIdUtil } from '@/lib/serverUtils';
import {AuthorizationType, ResourceType} from "@/app/types/authorization";
import {checkPermission, extractTokenAndUserId} from "@/services/authService";
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';
import { addBulkRowWithCounter, createBulkWithMain, createPairedTransactions, createTransactionWithBalance } from '@/services/transactionService';

export async function POST(req: Request) {
  const { userId } = extractTokenAndUserId(req as any);

  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 401 });
  }

  const perm = await checkPermission( req, ResourceType.transactions, AuthorizationType.write_all );
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }

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
  const globalBudgetPlanId = getField('globalBudgetPlanId');
  const globalCostCenterId = getField('globalCostCenterId');
  const individualDates = String(getField('individualDates') || '').toLowerCase() === 'true';

  const bulkTypeLower = String(bulkType || '').toLowerCase();

  if (!date_valued || !bulkType) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { date_valued, bulkType } }, { status: 400 });
  }

  // --- Vereinfachte Modus-Validierung (gewünschte Logik) ---
  // Einzug/Auszahlung & Hauptkonto Kostenstelle: verboten
  // Einzug/Auszahlung & Hauptkonto Nutzer/Verrechnungskonto: erlaubt
  // Kontobewegung & Hauptkonto Bank: erlaubt

  const isDeposit = bulkTypeLower === 'einzahlung';
  const isCollection = bulkTypeLower === 'einzug';
  const isPayout = bulkTypeLower === 'auszahlung';

  if (!isDeposit && !isCollection && !isPayout) {
    return NextResponse.json({ error: 'Ungültige Einzugsart' }, { status: 400 });
  }

  // Bei Einzug/Auszahlung sind Kostenstellen-Features NICHT erlaubt
  if (!isDeposit) {
    if (globalBudgetPlanId || globalCostCenterId) {
      return NextResponse.json({ error: 'Kostenstelle ist bei Einzug/Auszahlung nicht erlaubt.' }, { status: 400 });
    }
  }

  // Hauptkonto muss immer gesetzt sein (in dieser vereinfachten Logik)
  if (!accountType || !accountId) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { accountType, accountId } }, { status: 400 });
  }

  const accountTypeLower = String(accountType).toLowerCase();

  if ((isCollection || isPayout) && accountTypeLower === 'cost_center') {
    return NextResponse.json({ error: 'Kostenstelle ist bei Einzug/Auszahlung nicht erlaubt.' }, { status: 400 });
  }

  if ((isCollection || isPayout) && !['user', 'clearing_account'].includes(accountTypeLower)) {
    return NextResponse.json({ error: 'Auswahltyp für Hauptkonto passt nicht zur Einzugsart' }, { status: 400 });
  }

  if (isDeposit && accountTypeLower !== 'bank') {
    return NextResponse.json({ error: 'Bei Kontobewegungen muss ein Bankkonto als Hauptkonto gewählt werden.' }, { status: 400 });
  }

  // Kontobewegung: wir erzwingen weiterhin "Datum einzeln" (UI sollte das auch machen)
  if (isDeposit && !individualDates) {
    return NextResponse.json({ error: 'Bei Kontobewegung muss "Datum einzeln" aktiv sein.' }, { status: 400 });
  }

  // Pflichtbeschreibung: bei Kontobewegung optional (Zeilenbeschreibung Pflicht), sonst global Pflicht
  if (!isDeposit && !description) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { description } }, { status: 400 });
  }

  // Attachment-Typ prüfen
  if (file && !isAllowedAttachment((file as any).type)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt (nur Bilder oder PDF)' }, { status: 400 });
  }

  // Hauptkonto auflösen
  const mainAccountId = await resolveAccountIdUtil(prisma as any, String(accountType), String(accountId));
  if (!mainAccountId) {
    return NextResponse.json({ error: 'Hauptkonto konnte nicht aufgelöst werden' }, { status: 400 });
  }

  // BulkType Enum
  let bulkTypeEnum: BulkTransactionType;
  if (isPayout) bulkTypeEnum = BulkTransactionType.payout;
  else if (isCollection) bulkTypeEnum = BulkTransactionType.collection;
  else bulkTypeEnum = BulkTransactionType.deposit;

  // Rows parsen
  let rows: any[] = [];
  try {
    rows = JSON.parse(String(rowsRaw || '[]'));
  } catch {
    return NextResponse.json({ error: 'Ungültige Einzelbuchungen' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Mindestens eine Einzelbuchung erforderlich' }, { status: 400 });
  }

  const attachmentId = await saveAttachmentFromFormFile(prisma as any, file);
  const dateVal = new Date(String(date_valued));

  // Signs
  const mainSign = isPayout ? -1 : 1; // Auszahlung: Hauptkonto negativ; Einzug + Einzahlung: positiv

  // Prepared rows
  type PreparedRow = { accountId: number; amount: number; description: string; reference?: string; dateValued?: Date };
  type PreparedMainOnlyRow = { amount: number; description: string; reference?: string; dateValued?: Date; costCenterId: number };
  const preparedRows: PreparedRow[] = [];
  const preparedMainOnlyRows: PreparedMainOnlyRow[] = [];
  let totalAbsAmount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idxInfo = `Zeile ${i + 1}`;

    // Datum je Zeile
    const rowDateStr: string | undefined = individualDates ? String(row.date || '') : undefined;
    const rowDateVal: Date | undefined = rowDateStr ? new Date(rowDateStr) : undefined;

    // Betrag
    let rawAmountNum: number | null;
    if (isDeposit) {
      const num = Number(row.amount);
      rawAmountNum = Number.isFinite(num) ? num : null;
    } else {
      rawAmountNum = parsePositiveAmount(row.amount);
    }
    if (rawAmountNum === null) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Betrag` }, { status: 400 });
    }
    const amountAbs = roundToTwoDecimals(Math.abs(rawAmountNum));

    // Kontobewegung: Vorzeichen beibehalten (auch negativ erlaubt)
    const amountSignedDeposit = isDeposit ? roundToTwoDecimals(rawAmountNum) : undefined;

    // Beschreibung
    if (isDeposit && !String(row?.description || '').trim()) {
      return NextResponse.json({ error: `${idxInfo}: Beschreibung ist bei Kontobewegung ein Pflichtfeld` }, { status: 400 });
    }

    // Zeile: entweder Konto (user/clearing) ODER (nur bei Kontobewegung) cost_center (bucht direkt aufs Hauptkonto)
    if (String(row.type) === 'cost_center') {
      if (!isDeposit) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle ist bei Einzug/Auszahlung nicht erlaubt.` }, { status: 400 });
      }
      if (!row.budgetPlanId || !row.costCenterId) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstellenzeile erfordert Haushaltsplan und Kostenstelle` }, { status: 400 });
      }
      // Bei Kontobewegung wird der Betrag direkt auf dem Hauptkonto gebucht (Vorzeichen beibehalten)
      const signedMain = Number(amountSignedDeposit);
      let txDescription = String(description || '');
      if (row.description) txDescription += (txDescription ? ' - ' : '') + row.description;
      preparedMainOnlyRows.push({
        amount: signedMain,
        description: txDescription,
        reference: String(reference || ''),
        costCenterId: Number(row.costCenterId),
        ...(rowDateVal ? { dateValued: rowDateVal } : {}),
      });
      continue;
    }

    // Konto-Zeile
    if (!row?.id) {
      return NextResponse.json({ error: `${idxInfo}: Bitte ein Konto auswählen` }, { status: 400 });
    }

    const rowTypeLower = String(row.type).toLowerCase();
    if (!['user', 'clearing_account'].includes(rowTypeLower)) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Typ (erlaubt: Nutzer, Verrechnungskonto)` }, { status: 400 });
    }

    const accId = await resolveAccountIdUtil(prisma as any, rowTypeLower, row.id);
    if (!accId) {
      return NextResponse.json({ error: `${idxInfo}: Konto konnte nicht aufgelöst werden` }, { status: 400 });
    }

    const signedRow = isCollection ? -Math.abs(rawAmountNum) : (isPayout ? Math.abs(rawAmountNum) : Number(rawAmountNum));
    totalAbsAmount += amountAbs;

    let txDescription = String(description || '');
    if (row.description) txDescription += (txDescription ? ' - ' : '') + row.description;

    preparedRows.push({
      accountId: accId,
      amount: signedRow,
      description: txDescription,
      reference: String(reference || ''),
      ...(rowDateVal ? { dateValued: rowDateVal } : {}),
    });
  }

  try {
    // Kontobewegung: jede Konto-Zeile als Paartransaktion + optionale Main-only Zeilen
    if (isDeposit) {
      const created = await prisma.$transaction(async (p: any) => {
        // Konto-Zeilen -> Paar
        for (const r of preparedRows) {
          const dv = r.dateValued ?? dateVal;
          await createPairedTransactions(p, {
            account1Id: r.accountId,
            amount1: r.amount,
            account2Id: Number(mainAccountId),
            amount2: r.amount,
            description: r.description,
            createdById: currentUser.id,
            reference: r.reference,
            dateValued: dv,
            attachmentId: attachmentId ?? null,
            costCenterId1: null,
            costCenterId2: null,
          });
        }

        // Kostenstellen-Zeilen -> Einzeltransaktion direkt aufs Hauptkonto (über Service)
        for (const r of preparedMainOnlyRows) {
          const dv = r.dateValued ?? dateVal;
          await createTransactionWithBalance(p, {
            accountId: Number(mainAccountId),
            amount: r.amount,
            description: r.description,
            reference: r.reference,
            dateValued: dv,
            createdById: currentUser.id,
            attachmentId: attachmentId ?? null,
            costCenterId: r.costCenterId,
          });
        }

        return { count: preparedRows.length + preparedMainOnlyRows.length };
      });

      return NextResponse.json(created, { status: 201 });
    }

    // Einzug/Auszahlung: klassischer Bulk (nur user/clearing rows)
    const result = await prisma.$transaction(async (p: any) => {
      const mainAmt = mainSign * totalAbsAmount;
      const { bulk, mainTx } = await createBulkWithMain(p, {
        mainAccountId: Number(mainAccountId),
        mainAmount: mainAmt,
        description: String(description),
        createdById: currentUser.id,
        type: bulkTypeEnum,
        dateValued: dateVal,
        reference: reference ? String(reference) : undefined,
        attachmentId: attachmentId ?? null,
      });

      for (const r of preparedRows) {
        await addBulkRowWithCounter(p, {
          bulkId: bulk.id,
          mainTxId: mainTx.id,
          rowAccountId: r.accountId,
          amount: r.amount,
          description: r.description,
          createdById: currentUser.id,
          dateValued: r.dateValued ?? dateVal,
          reference: r.reference,
          attachmentId: attachmentId ?? null,
          costCenterId: null,
        });
      }

      return { id: bulk.id, rows: preparedRows.length };
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
