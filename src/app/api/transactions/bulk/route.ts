import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isAllowedAttachment } from '@/lib/validation';
import { resolveAccountId as resolveAccountIdUtil } from '@/lib/serverUtils';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';
import { checkPermission, extractTokenAndUserId } from '@/services/authService';
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';
import {
  addBulkMainCostCenterRow,
  addBulkRowWithCounter,
  createBulkWithMain,
  createPairedTransactions,
  createTransactionWithBalance,
} from '@/services/transactionService';

function parseBoolean(v: FormDataEntryValue | null): boolean {
  if (v == null) return false;
  return String(v).toLowerCase() === 'true';
}

function parseDateOnlyOrThrow(value: string, fieldName: string): Date {
  // Erwartet YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Ungültiges Datum in '${fieldName}': ${value}`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Ungültiges Datum in '${fieldName}': ${value}`);
  }
  return d;
}

function parseAmountOrThrow(raw: any, rowIndex?: number): number {
  const s = String(raw ?? '').trim().replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) {
    const prefix = rowIndex != null ? `Zeile ${rowIndex + 1}: ` : '';
    throw new Error(prefix + `Ungültiger Betrag: ${String(raw)}`);
  }
  return n;
}

type IncomingRow = {
  date?: string;
  type?: 'user' | 'clearing_account' | 'cost_center';
  id?: string;
  amount?: string;
  description?: string;
  budgetPlanId?: string;
  costCenterId?: string;
};

type NormalizedAccountRow = {
  dateValued: Date;
  rowAccountId: number;
  amount: number; // positiv (Vorzeichen wird später gesetzt)
  description: string;
};

type NormalizedCostCenterRow = {
  dateValued: Date;
  costCenterId: number;
  amount: number; // positiv
  description: string;
};

async function resolveAccountIdOrThrow(p: typeof prisma, type: string, id: string, context: string): Promise<number> {
  const accountId = await resolveAccountIdUtil(p as any, type, id);
  const n = Number(accountId);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${context}: Konto konnte nicht aufgelöst werden (type=${type}, id=${id})`);
  }
  return n;
}

export async function POST(req: Request) {
  const { userId } = extractTokenAndUserId(req as any);

  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 401 });
  }

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
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

  try {
    const bulkTypeRaw = String(formData.get('bulkType') ?? '').trim();
    const individualDates = parseBoolean(formData.get('individualDates'));

    const headerDateStr = String(formData.get('date_valued') ?? '').trim();
    const headerDateValued = headerDateStr ? parseDateOnlyOrThrow(headerDateStr, 'date_valued') : null;

    const headerDescription = String(formData.get('description') ?? '').trim();
    const reference = String(formData.get('reference') ?? '').trim() || null;

    const rowsRaw = formData.get('rows');
    if (!rowsRaw) {
      return NextResponse.json({ error: "Feld 'rows' fehlt" }, { status: 400 });
    }

    let incomingRows: IncomingRow[];
    try {
      incomingRows = JSON.parse(String(rowsRaw));
    } catch (e: any) {
      return NextResponse.json({ error: "Feld 'rows' ist kein gültiges JSON", detail: e?.message }, { status: 400 });
    }
    if (!Array.isArray(incomingRows)) {
      return NextResponse.json({ error: "Feld 'rows' muss ein Array sein" }, { status: 400 });
    }

    // Attachment optional speichern
    const attachmentFile = formData.get('attachment');
    let attachmentId: number | null = null;
    if (attachmentFile instanceof File) {
      if (!isAllowedAttachment(attachmentFile.type)) {
        return NextResponse.json({ error: 'Nicht erlaubter Anhang' }, { status: 400 });
      }
      const savedId = await saveAttachmentFromFormFile(prisma, attachmentFile);
      attachmentId = savedId ?? null;
    }

    // main context
    const accountType = String(formData.get('accountType') ?? '').trim();
    const accountIdRaw = String(formData.get('accountId') ?? '').trim();

    const globalBudgetPlanIdRaw = String(formData.get('globalBudgetPlanId') ?? '').trim();
    const globalCostCenterIdRaw = String(formData.get('globalCostCenterId') ?? '').trim();

    const hasMainAccount = !!accountType && !!accountIdRaw;
    const hasGlobalCostCenter = !!globalBudgetPlanIdRaw && !!globalCostCenterIdRaw;

    if (!hasMainAccount && !hasGlobalCostCenter) {
      return NextResponse.json(
        { error: 'Bitte entweder ein Hauptkonto (accountType/accountId) oder globalBudgetPlanId/globalCostCenterId angeben.' },
        { status: 400 },
      );
    }

    if (bulkTypeRaw !== 'einzug' && bulkTypeRaw !== 'auszahlung' && bulkTypeRaw !== 'kontobewegung') {
      return NextResponse.json({ error: `Ungültiger bulkType: ${bulkTypeRaw}` }, { status: 400 });
    }

    if (!headerDateValued && !individualDates) {
      return NextResponse.json({ error: "Feld 'date_valued' fehlt" }, { status: 400 });
    }

    // 1) Zeilen normalisieren + splitten
    const normalizedAccountRows: NormalizedAccountRow[] = [];
    const normalizedCostCenterRows: NormalizedCostCenterRow[] = [];

    for (let i = 0; i < incomingRows.length; i++) {
      const r = incomingRows[i] ?? {};

      // Leere/Placeholder-Zeilen (UI lässt oft eine letzte leere Zeile stehen)
      const isPlaceholderRow =
        (!r.id || String(r.id).trim() === '') &&
        (!r.amount || String(r.amount).trim() === '') &&
        (!r.description || String(r.description).trim() === '') &&
        (!r.budgetPlanId || String(r.budgetPlanId).trim() === '') &&
        (!r.costCenterId || String(r.costCenterId).trim() === '') &&
        (!r.date || String(r.date).trim() === '');
      if (isPlaceholderRow) continue;

      const type = r.type;
      if (type !== 'user' && type !== 'clearing_account' && type !== 'cost_center') {
        return NextResponse.json({ error: `Zeile ${i + 1}: Ungültiger type`, detail: String(type), rowIndex: i }, { status: 400 });
      }

      const amount = parseAmountOrThrow(r.amount, i);
      if (bulkTypeRaw !== 'kontobewegung' && !(amount > 0)) {
        return NextResponse.json({ error: `Zeile ${i + 1}: Betrag muss größer 0 sein`, rowIndex: i }, { status: 400 });
      }

      const rowDesc = String(r.description ?? '').trim() || headerDescription;
      if (!rowDesc && bulkTypeRaw !== 'kontobewegung') {
        return NextResponse.json({ error: `Zeile ${i + 1}: Beschreibung fehlt`, rowIndex: i }, { status: 400 });
      }

      let dateValued: Date;
      if (individualDates) {
        const rowDateStr = String(r.date ?? '').trim();
        if (!rowDateStr) {
          return NextResponse.json({ error: `Zeile ${i + 1}: Datum fehlt (individualDates aktiv)`, rowIndex: i }, { status: 400 });
        }
        try {
          dateValued = parseDateOnlyOrThrow(rowDateStr, `rows[${i}].date`);
        } catch (e: any) {
          return NextResponse.json({ error: `Zeile ${i + 1}: Ungültiges Datum`, detail: e?.message, rowIndex: i }, { status: 400 });
        }
      } else {
        dateValued = headerDateValued as Date;
      }

      if (type === 'cost_center') {
        const ccId = Number(String(r.costCenterId ?? '').trim());
        if (!Number.isFinite(ccId) || ccId <= 0) {
          return NextResponse.json({ error: `Zeile ${i + 1}: costCenterId fehlt/ungültig`, rowIndex: i }, { status: 400 });
        }
        normalizedCostCenterRows.push({
          dateValued,
          costCenterId: ccId,
          amount,
          description: rowDesc || '(ohne Beschreibung)',
        });
      } else {
        const idStr = String(r.id ?? '').trim();
        if (!idStr) {
          return NextResponse.json({ error: `Zeile ${i + 1}: id fehlt`, rowIndex: i }, { status: 400 });
        }
        let rowAccountId: number;
        try {
          rowAccountId = await resolveAccountIdOrThrow(prisma, type, idStr, `Zeile ${i + 1}`);
        } catch (e: any) {
          return NextResponse.json({ error: `Zeile ${i + 1}: Konto konnte nicht aufgelöst werden`, detail: e?.message, rowIndex: i }, { status: 400 });
        }
        normalizedAccountRows.push({
          dateValued,
          rowAccountId,
          amount,
          description: rowDesc || '(ohne Beschreibung)',
        });
      }
    }

    if (!normalizedAccountRows.length && !normalizedCostCenterRows.length) {
      return NextResponse.json({ error: 'Keine gültigen Zeilen vorhanden' }, { status: 400 });
    }

    // Sortieren, damit deterministische Reihenfolge (Datum, dann Konto/Kostenstelle)
    normalizedAccountRows.sort((a, b) => a.dateValued.getTime() - b.dateValued.getTime() || a.rowAccountId - b.rowAccountId);
    normalizedCostCenterRows.sort((a, b) => a.dateValued.getTime() - b.dateValued.getTime() || a.costCenterId - b.costCenterId);

    // 2) Buchungen anlegen
    if (bulkTypeRaw === 'kontobewegung') {
      if (!hasMainAccount) {
        return NextResponse.json({ error: 'Kontobewegung benötigt ein Hauptkonto (accountType/accountId).' }, { status: 400 });
      }

      // Für kontobewegung: accountRows werden als Paarbuchung gebucht (Hauptkonto +, Gegenkonto -).
      // Kostenstellen-Zeilen werden als einzelne Buchung auf dem Hauptkonto mit costCenterId gebucht.

      const mainAccountId = await resolveAccountIdOrThrow(prisma, accountType, accountIdRaw, 'Hauptkonto');
      const created = await prisma.$transaction(async (p) => {
        const transactionIds: number[] = [];
        for (const r of normalizedAccountRows) {
          // Vorzeichen wie in der jeweiligen Zeile für beide Accounts: wir verwenden die Zeilenmenge als "amount" inkl. Vorzeichen
          // Da UI -> amount immer positiv ist, interpretieren wir kontobewegung hier als: Hauptkonto +amount, Gegenkonto -amount.
          const { tx1, tx2 } = await createPairedTransactions(p, {
            account1Id: mainAccountId,
            amount1: r.amount,
            account2Id: r.rowAccountId,
            amount2: r.amount,
            description: r.description,
            createdById: currentUser.id,
            reference,
            dateValued: r.dateValued,
            attachmentId,
          });
          transactionIds.push(tx1.id, tx2.id);
        }

        for (const cc of normalizedCostCenterRows) {
          const tx = await createTransactionWithBalance(p, {
            accountId: mainAccountId,
            amount: cc.amount,
            description: cc.description,
            createdById: currentUser.id,
            reference,
            dateValued: cc.dateValued,
            attachmentId,
            costCenterId: cc.costCenterId,
          });
          transactionIds.push(tx.id);
        }
        return { transactionIds };
      });

      return NextResponse.json({ ok: true, ...created }, { status: 200 });
    }

    // einzug/auszahlung
    const mainSign = bulkTypeRaw === 'einzug' ? 1 : -1;

    if (hasMainAccount) {
      const mainAccountId = await resolveAccountIdOrThrow(prisma, accountType, accountIdRaw, 'Hauptkonto');

      const bulkType: 'collection' | 'payout' = bulkTypeRaw === 'einzug' ? 'collection' : 'payout';

      // individualDates? -> Paare pro Datum (kein Bulk), sonst Bulk mit Main
      if (individualDates) {
        const created = await prisma.$transaction(async (p) => {
          const transactionIds: number[] = [];

          for (const r of normalizedAccountRows) {
            const { tx1, tx2 } = await createPairedTransactions(p, {
              account1Id: mainAccountId,
              amount1: mainSign * r.amount,
              account2Id: r.rowAccountId,
              amount2: -mainSign * r.amount,
              description: r.description,
              createdById: currentUser.id,
              reference,
              dateValued: r.dateValued,
              attachmentId,
            });
            transactionIds.push(tx1.id, tx2.id);
          }

          for (const cc of normalizedCostCenterRows) {
            const tx = await createTransactionWithBalance(p, {
              accountId: mainAccountId,
              amount: mainSign * cc.amount,
              description: cc.description,
              createdById: currentUser.id,
              reference,
              dateValued: cc.dateValued,
              attachmentId,
              costCenterId: cc.costCenterId,
            });
            transactionIds.push(tx.id);
          }

          return { transactionIds };
        });

        return NextResponse.json({ ok: true, ...created }, { status: 200 });
      }

      // !individualDates -> echtes Bulk
      const dateValued = headerDateValued as Date;

      // Summe nur aus accountRows (Kostenstellen-Row sind Buchungen auf Hauptkonto ohne Gegenkonto)
      const sumAccountRows = normalizedAccountRows.reduce((acc, r) => acc + r.amount, 0);
      if (!(sumAccountRows > 0) && !normalizedCostCenterRows.length) {
        return NextResponse.json({ error: 'Summe der Zeilen muss größer 0 sein' }, { status: 400 });
      }

      const descriptionForBulk = headerDescription || normalizedAccountRows[0]?.description || normalizedCostCenterRows[0]?.description || '(ohne Beschreibung)';

      const created = await prisma.$transaction(async (p) => {
        const createdTransactionIds: number[] = [];

        const { bulk, mainTx } = await createBulkWithMain(p, {
          mainAccountId,
          mainAmount: mainSign * sumAccountRows,
          description: descriptionForBulk,
          createdById: currentUser.id,
          type: bulkType,
          dateValued,
          reference,
          attachmentId,
        });
        createdTransactionIds.push(mainTx.id);

        for (const r of normalizedAccountRows) {
          const tx = await addBulkRowWithCounter(p, {
            bulkId: bulk.id,
            mainTxId: mainTx.id,
            rowAccountId: r.rowAccountId,
            amount: -mainSign * r.amount,
            description: r.description,
            createdById: currentUser.id,
            dateValued,
            reference,
            attachmentId,
          });
          createdTransactionIds.push(tx.id);
        }

        for (const cc of normalizedCostCenterRows) {
          const tx = await addBulkMainCostCenterRow(p, {
            bulkId: bulk.id,
            mainAccountId,
            amount: mainSign * cc.amount,
            description: cc.description,
            createdById: currentUser.id,
            dateValued,
            reference,
            attachmentId,
            costCenterId: cc.costCenterId,
          });
          createdTransactionIds.push(tx.id);
        }

        return { bulkId: bulk.id, mainTransactionId: mainTx.id, transactionIds: createdTransactionIds };
      });

      return NextResponse.json({ ok: true, ...created }, { status: 200 });
    }

    // else: Haupt-Kostenstelle-Modus (kein Hauptkonto, aber globalCostCenter)
    if (normalizedCostCenterRows.length) {
      return NextResponse.json({ error: 'In diesem Modus sind keine Kostenstellen-Zeilen erlaubt.' }, { status: 400 });
    }

    // In diesem Modus werden IMMER einzelne Transaktionen angelegt (auch wenn individualDates=false),
    // weil es kein Hauptkonto/Bulk gibt. Bei individualDates=true kommt das Datum pro Zeile aus der Normalisierung.

    const globalCostCenterId = Number(globalCostCenterIdRaw);
    if (!Number.isFinite(globalCostCenterId) || globalCostCenterId <= 0) {
      return NextResponse.json({ error: 'globalCostCenterId fehlt/ungültig' }, { status: 400 });
    }

    // Laut Wunsch: hier einfach einzelne Transaktionen buchen und die Kostenstelle hinterlegen.
    // Einzug: von den Accounts abziehen (negativ). Auszahlung: gutschreiben (positiv).
    const sign = bulkTypeRaw === 'einzug' ? -1 : 1;

    const created = await prisma.$transaction(async (p) => {
      const transactionIds: number[] = [];

      for (const r of normalizedAccountRows) {
        const tx = await createTransactionWithBalance(p, {
          accountId: r.rowAccountId,
          amount: sign * r.amount,
          description: r.description,
          createdById: currentUser.id,
          reference,
          dateValued: r.dateValued,
          attachmentId,
          costCenterId: globalCostCenterId,
        });
        transactionIds.push(tx.id);
      }

      return { transactionIds };
    });

    return NextResponse.json({ ok: true, ...created }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Fehler beim Anlegen der Bulk-Transaktionen', detail: err?.message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
