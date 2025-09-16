import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { BulkTransactionType } from '@prisma/client';
import { isAllowedAttachment, isAllowedMainAccountForBulk, isAllowedRowTypeForBulk, parsePositiveAmount, roundToTwoDecimals } from '@/lib/validation';
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

  if (!date_valued || !description || !bulkType) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { date_valued, description, bulkType } }, { status: 400 });
  }

  const isCostCenterMode = Boolean(globalBudgetPlanId && globalCostCenterId);

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

  // Bei Einzahlung ist Kostenstellenmodus nicht erlaubt
  if (bulkTypeLower === 'einzahlung' && isCostCenterMode) {
    return NextResponse.json({ error: 'Kostenstelle ist bei Einzahlung nicht erlaubt. Bitte Bankkonto als Hauptkonto verwenden.' }, { status: 400 });
  }

  // Nur im Nicht-Kostenstellenmodus: Hauptkonto prüfen/auflösen
  let mainAccountId: number | null = null;
  if (!isCostCenterMode) {
    if (!accountType || !accountId) {
      return NextResponse.json({ error: 'Pflichtfelder fehlen', fields: { accountType, accountId } }, { status: 400 });
    }
    if (!isAllowedMainAccountForBulk(bulkTypeLower as any, accountType as any)) {
      return NextResponse.json({ error: 'Auswahltyp für Hauptkonto passt nicht zur Einzugsart' }, { status: 400 });
    }
    mainAccountId = await resolveAccountIdUtil(prisma as any, String(accountType), String(accountId));
    if (!mainAccountId) {
      return NextResponse.json({ error: 'Hauptkonto konnte nicht aufgelöst werden' }, { status: 400 });
    }
  }

  // Globaler Kostenstellenmodus prüfen
  let globalCostCenterIdNum: number | undefined = undefined;
  if ((globalBudgetPlanId && !globalCostCenterId) || (!globalBudgetPlanId && globalCostCenterId)) {
    return NextResponse.json({ error: 'Globaler Modus: Haushaltsplan und Kostenstelle müssen beide gesetzt sein.' }, { status: 400 });
  }
  if (isCostCenterMode) {
    const cc = await prisma.costCenter.findUnique({ where: { id: Number(globalCostCenterId) } });
    if (!cc) {
      return NextResponse.json({ error: 'Globale Kostenstelle nicht gefunden' }, { status: 400 });
    }
    if (cc.budget_planId !== Number(globalBudgetPlanId)) {
      return NextResponse.json({ error: 'Globale Kostenstelle gehört nicht zum gewählten Haushaltsplan' }, { status: 400 });
    }
    const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(globalBudgetPlanId) }, select: { state: true } });
    if (!plan || plan.state !== 'active') {
      return NextResponse.json({ error: 'Gewählter Haushaltsplan ist nicht aktiv' }, { status: 400 });
    }
    globalCostCenterIdNum = Number(cc.id);
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

  function rowAmountSigned(raw: number): number {
    if (bulkTypeLower === 'einzug') return -Math.abs(raw);
    if (bulkTypeLower === 'auszahlung') return Math.abs(raw);
    if (bulkTypeLower === 'einzahlung') return Math.abs(raw);
    return Math.abs(raw);
  }
  // Sign für Hauptkonto (Gegenbuchung zu user rows)
  let mainSign = 1;
  if (bulkTypeLower === 'auszahlung') mainSign = -1;
  if (bulkTypeLower === 'einzug') mainSign = 1;
  if (bulkTypeLower === 'einzahlung') mainSign = 1;

  type PreparedRow = { accountId: number, amount: number, description: string, reference?: string, costCenterId?: number };
  type PreparedCostCenterRow = { amount: number, description: string, reference?: string, costCenterId: number };
  const preparedRows: PreparedRow[] = []; // rows mit Konto (user / clearing)
  const preparedCostCenterRows: PreparedCostCenterRow[] = []; // rows nur Kostenstelle
  let totalAbsAmount = 0; // summe nur der rows mit Konto

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idxInfo = `Zeile ${i + 1}`;

    const rawAmountNum = parsePositiveAmount(row.amount);
    if (rawAmountNum === null) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Betrag` }, { status: 400 });
    }
    const amountCents = roundToTwoDecimals(rawAmountNum);

    const hasRowAccount = Boolean(row.id);
    const hasRowCostCenter = Boolean(row.costCenterId && row.budgetPlanId);

    // Validierung Kostenstellen (Zeilen-Ebene) im Nicht-Global-Modus
    if (hasRowCostCenter && isCostCenterMode) {
      return NextResponse.json({ error: `${idxInfo}: Einzel-Kostenstellen nicht zulässig, da globaler Kostenstellenmodus aktiv ist` }, { status: 400 });
    }
    if (hasRowCostCenter) {
      // Budgetplan + Kostenstelle prüfen
      const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(row.budgetPlanId) }, select: { state: true } });
      if (!plan || plan.state !== 'active') {
        return NextResponse.json({ error: `${idxInfo}: Haushaltsplan inaktiv oder nicht gefunden` }, { status: 400 });
      }
      const cc = await prisma.costCenter.findUnique({ where: { id: Number(row.costCenterId) } });
      if (!cc || cc.budget_planId !== Number(row.budgetPlanId)) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle gehört nicht zum Haushaltsplan` }, { status: 400 });
      }
    }

    if (!hasRowAccount && !hasRowCostCenter) {
      return NextResponse.json({ error: `${idxInfo}: Entweder Auswahl (Konto) oder Kostenstelle erforderlich` }, { status: 400 });
    }

    // Fall 1: Row nur Kostenstelle (kein Konto) -> direkte Buchung auf Hauptkonto, aber nur wenn Hauptkonto vorhanden (kein globaler Modus)
    if (!hasRowAccount && hasRowCostCenter) {
      if (isCostCenterMode) {
        return NextResponse.json({ error: `${idxInfo}: Konto erforderlich im globalen Kostenstellenmodus` }, { status: 400 });
      }
      if (!mainAccountId) {
        return NextResponse.json({ error: `${idxInfo}: Hauptkonto nicht gesetzt für Kostenstellenzeile` }, { status: 400 });
      }
      const signed = mainSign * amountCents; // direkt auf Hauptkonto
      let txDescription = String(description);
      if (row.description) txDescription += ' - ' + row.description;
      preparedCostCenterRows.push({ amount: signed, description: txDescription, reference: String(reference || ''), costCenterId: Number(row.costCenterId) });
      continue; // nächste Zeile
    }

    // Ab hier: rows mit Konto (user / clearing)
    if (!isAllowedRowTypeForBulk(row.type)) {
      return NextResponse.json({ error: `${idxInfo}: Ungültiger Typ (erlaubt: Nutzer, Verrechnungskonto)` }, { status: 400 });
    }
    const accId = await resolveAccountIdUtil(prisma as any, row.type, row.id);
    if (!accId) {
      return NextResponse.json({ error: `${idxInfo}: Konto konnte nicht aufgelöst werden` }, { status: 400 });
    }

    // Budgetplan/Kostenstelle bei rows mit Konto nur zulässig, wenn NICHT globaler Modus und beide angegeben
    if (row.costCenterId || row.budgetPlanId) {
      if (!hasRowCostCenter) {
        return NextResponse.json({ error: `${idxInfo}: Sowohl Haushaltsplan als auch Kostenstelle erforderlich` }, { status: 400 });
      }
      const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(row.budgetPlanId) }, select: { state: true } });
      if (!plan || plan.state !== 'active') {
        return NextResponse.json({ error: `${idxInfo}: Haushaltsplan inaktiv oder nicht gefunden` }, { status: 400 });
      }
      const cc = await prisma.costCenter.findUnique({ where: { id: Number(row.costCenterId) } });
      if (!cc || cc.budget_planId !== Number(row.budgetPlanId)) {
        return NextResponse.json({ error: `${idxInfo}: Kostenstelle gehört nicht zum Haushaltsplan` }, { status: 400 });
      }
    }

    const signed = rowAmountSigned(amountCents);
    totalAbsAmount += amountCents;
    let txDescription = String(description);
    if (row.description) txDescription += ' - ' + row.description;
    preparedRows.push({ accountId: accId, amount: signed, description: txDescription, reference: String(reference || ''), ...(
      hasRowCostCenter ? { costCenterId: Number(row.costCenterId) } : (globalCostCenterIdNum ? { costCenterId: globalCostCenterIdNum } : {})
    ) });
  }

  const attachmentId = await saveAttachmentFromFormFile(prisma as any, file);

  try {
    if (isCostCenterMode) {
      // Unverändert: globaler Kostenstellenmodus verlangt weiterhin Konto-Zeilen
      await prisma.$transaction(async (p: any) => {
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
                createdBy: { connect: { id: currentUser.id } },
                ...(r.costCenterId ? { costCenter: { connect: { id: r.costCenterId } } } : {}),
              },
            });
            await p.account.update({ where: { id: r.accountId }, data: { balance: newBal } });
        }
      });
      return NextResponse.json({ count: preparedRows.length }, { status: 201 });
    }

    // Standard: Bulk mit Haupt- und Gegenbuchungen (preparedRows) + zusätzliche Kostenstellen-Zeilen ohne Konto (preparedCostCenterRows)
    const result = await prisma.$transaction(async (p: any) => {
      const mainAcc = await p.account.findUnique({ where: { id: mainAccountId } });
      const mainBal = mainAcc ? Number(mainAcc.balance) : 0;
      const mainAmt = mainSign * totalAbsAmount;
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

      // Rows mit Konto
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
            ...(r.costCenterId ? { costCenter: { connect: { id: r.costCenterId } } } : {}),
          },
        });
        await p.account.update({ where: { id: r.accountId }, data: { balance: newBal } });
      }

      // Rows nur Kostenstelle -> direkte Buchung aufs Hauptkonto (kein Bulk-Link in mainTx-Summe, aber Bulk-Verknüpfung ohne Gegenbuchung)
      if (preparedCostCenterRows.length) {
        let currentMainBal = mainNewBal;
        for (const r of preparedCostCenterRows) {
          currentMainBal += r.amount;
          await p.transaction.create({
            data: {
              amount: r.amount,
              date_valued: new Date(String(date_valued)),
              description: r.description,
              reference: r.reference,
              account: { connect: { id: mainAccountId } },
              accountValueAfter: currentMainBal,
              ...(attachmentId ? { attachment: { connect: { id: attachmentId } } } : {}),
              createdBy: { connect: { id: currentUser.id } },
              costCenter: { connect: { id: r.costCenterId } },
              transactionBulk: { connect: { id: bulk.id } },
            },
          });
        }
        await p.account.update({ where: { id: mainAccountId }, data: { balance: currentMainBal } });
      }

      await p.transaction.update({ where: { id: mainTx.id }, data: { transactionBulk: { connect: { id: bulk.id } } } });

      return { id: bulk.id, rows: preparedRows.length, costCenterRows: preparedCostCenterRows.length };
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
