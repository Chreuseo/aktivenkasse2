import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { generateTransactionsPdf, generateBudgetPlanPdf } from "@/lib/pdf";
import type { BudgetPlanTxRow } from "@/lib/pdf";

export const runtime = 'nodejs';

function inferOtherFromAccount(acc: any): string | undefined {
  if (!acc) return undefined;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return `Nutzer: ${u.first_name} ${u.last_name}`;
    }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return `Bankkonto: ${b.name}${b.bank ? ` (${b.bank})` : ''}`;
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return `Verrechnungskonto: ${c.name}`;
  }
  return undefined;
}

function mapTypeToResource(type: string): ResourceType | null {
  switch (type) {
    case 'user':
      return ResourceType.userAuth;
    case 'clearing':
      return ResourceType.clearing_accounts;
    case 'bank':
      return ResourceType.bank_accounts;
    case 'household':
    case 'budget_plan':
      return ResourceType.budget_plan;
    default:
      return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const idStr = url.searchParams.get('id');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const variant = (url.searchParams.get('variant') as 'simpel' | 'anonym' | 'voll' | null) || null;

  if (!type) {
    return NextResponse.json({ error: 'type fehlt' }, { status: 400 });
  }
  const resource = mapTypeToResource(type);
  if (!resource) {
    return NextResponse.json({ error: 'Ungültiger type' }, { status: 400 });
  }

  if (!idStr) {
    return NextResponse.json({ error: 'id fehlt' }, { status: 400 });
  }

  // Budget-Plan Variante behandeln
  if (resource === ResourceType.budget_plan) {
    // Erlaubt sind nur geschlossene Pläne; Permission für budget_plan read_all
    const perm = await checkPermission(req, ResourceType.budget_plan, AuthorizationType.read_all);
    if (!perm.allowed) {
      return NextResponse.json({ error: 'Keine Berechtigung für read_all auf budget_plan' }, { status: 403 });
    }

    const planId = Number(idStr);
    if (Number.isNaN(planId)) return NextResponse.json({ error: 'Ungültige id' }, { status: 400 });

    try {
      const plan = await prisma.budgetPlan.findUnique({
        where: { id: planId },
        include: {
          costCenters: {
            include: { nextCostCenterObj: true },
          },
        },
      });
      if (!plan) return NextResponse.json({ error: 'Haushalt nicht gefunden' }, { status: 404 });
      if ((plan as any).state !== 'closed') {
        return NextResponse.json({ error: 'Nur geschlossene Haushalte können exportiert werden' }, { status: 400 });
      }

      // Sortierung der Kostenstellen über verkettete Liste
      const ccMap = new Map<number, any>();
      for (const cc of plan.costCenters) ccMap.set(cc.id, cc);
      const ordered: any[] = [];
      const firstId = (plan as any).firstCostCenter as number | null | undefined;
      const visited = new Set<number>();
      let currentId = firstId ?? null;
      while (currentId && ccMap.has(currentId) && !visited.has(currentId)) {
        const node = ccMap.get(currentId);
        ordered.push(node);
        visited.add(currentId);
        currentId = (node.nextCostCenter as number | null | undefined) ?? null;
      }
      // Hänge alle übrigen (nicht verketteten) hinten dran in ID-Reihenfolge
      for (const cc of [...ccMap.values()].sort((a, b) => a.id - b.id)) {
        if (!visited.has(cc.id)) ordered.push(cc);
      }

      // Summaries aufbauen
      const summaries = ordered.map((cc) => {
        const expectedCosts = Number(cc.costs_expected ?? 0);
        const actualCosts = Number(cc.costs_actual ?? 0);
        const expectedEarnings = Number(cc.earnings_expected ?? 0);
        const actualEarnings = Number(cc.earnings_actual ?? 0);
        return {
          name: cc.name as string,
          expectedCosts,
          actualCosts,
          expectedEarnings,
          actualEarnings,
          expectedResult: expectedEarnings - expectedCosts,
          actualResult: actualEarnings - actualCosts,
        };
      });

      // Details je nach Variante
      let details: { name: string; txs: BudgetPlanTxRow[] }[] | undefined = undefined;
      const wantFull = variant === 'voll';
      const wantAnonym = variant === 'anonym' || wantFull; // anonym oder voll

      if (wantFull) {
        // Zusatzberechtigung: read_all für transactions
        const permTx = await checkPermission(req, ResourceType.transactions, AuthorizationType.read_all);
        if (!permTx.allowed) {
          return NextResponse.json({ error: 'Variante "voll" erfordert read_all für Transaktionen' }, { status: 403 });
        }
      }

      if (wantAnonym) {
        const costCenterIds = ordered.map(cc => cc.id);
        const txs = await prisma.transaction.findMany({
          where: { costCenterId: { in: costCenterIds } },
          orderBy: { date_valued: 'asc' },
          include: wantFull ? {
            account: {
              include: {
                users: true, bankAccounts: true, clearingAccounts: true
              }
            }
          } : undefined,
        } as any);

        const byCc = new Map<number, { date: string; description: string; amount: number; other?: string }[]>();
        for (const ccId of costCenterIds) byCc.set(ccId, []);
        for (const t of txs) {
          const arr = byCc.get(t.costCenterId as number) as any[];
          let other: string | undefined;
          if (wantFull && (t as any).account) {
            other = inferOtherFromAccount((t as any).account);
          }
          arr.push({
            date: ((t as any).date_valued || (t as any).date).toISOString(),
            description: (t as any).description,
            amount: Number((t as any).amount),
            other,
          });
        }
        details = ordered.map(cc => ({ name: cc.name as string, txs: byCc.get(cc.id) || [] }));
      }

      const title = `Haushalt: ${plan.name} — Export${variant ? ` (${variant})` : ''}`;
      const pdfBuf = await generateBudgetPlanPdf(title, {
        planName: plan.name,
        variant: (variant as any) || 'simpel',
        summaries,
        details,
      });

      const filenameSafe = (`Haushalt_${plan.name}_${variant || 'simpel'}`).replace(/[^\w\s-.]/g, '').replace(/\s+/g, '_');
      const filename = `${filenameSafe}_${new Date().toISOString().slice(0,10)}.pdf`;

      const uint8 = new Uint8Array(pdfBuf);
      const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);

      return new NextResponse(arrayBuffer as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (e: any) {
      console.error(e);
      return NextResponse.json({ error: 'Fehler beim Erstellen des Haushalts-Exports', detail: e?.message }, { status: 500 });
    }
  }

  // Nicht-Budget-Plan Exporte
  // Permission prüfen: read_all auf entsprechender Ressource
  const perm = await checkPermission(req, resource, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: `Keine Berechtigung für read_all auf ${resource}` }, { status: 403 });
  }

  let accountId: number | null = null;
  let titleSubject = '';

  try {
    if (resource === ResourceType.userAuth) {
      const user = await prisma.user.findUnique({ where: { id: Number(idStr) }, include: { account: true } });
      if (!user || !user.account) return NextResponse.json({ error: 'Nutzer oder Konto nicht gefunden' }, { status: 404 });
      accountId = user.account.id;
      titleSubject = `Nutzer: ${user.first_name} ${user.last_name}`;
    } else if (resource === ResourceType.clearing_accounts) {
      const ca = await prisma.clearingAccount.findUnique({ where: { id: Number(idStr) }, include: { account: true } });
      if (!ca || !ca.account) return NextResponse.json({ error: 'Verrechnungskonto oder Konto nicht gefunden' }, { status: 404 });
      accountId = ca.account.id;
      titleSubject = `Verrechnungskonto: ${ca.name}`;
    } else if (resource === ResourceType.bank_accounts) {
      const ba = await prisma.bankAccount.findUnique({ where: { id: Number(idStr) }, include: { account: true } });
      if (!ba || !ba.account) return NextResponse.json({ error: 'Bankkonto oder Konto nicht gefunden' }, { status: 404 });
      accountId = ba.account.id;
      titleSubject = `Bankkonto: ${ba.name}${ba.bank ? ` (${ba.bank})` : ''}`;
    }
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: 'Fehler beim Auflösen des Kontos', detail: e?.message }, { status: 500 });
  }

  if (!accountId) {
    return NextResponse.json({ error: 'Konto konnte nicht ermittelt werden' }, { status: 400 });
  }

  const where: any = { accountId: accountId };
  // Datumsbereich filtern (date_valued bevorzugen)
  if (fromStr || toStr) {
    const gte = fromStr ? new Date(fromStr) : undefined;
    // inklusive Ende des Tages für 'to'
    const lte = toStr ? new Date(new Date(toStr).setHours(23, 59, 59, 999)) : undefined;
    where.date_valued = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }

  try {
    const txs = await prisma.transaction.findMany({
      where,
      orderBy: { date_valued: 'asc' },
      include: {
        counter_transaction: {
          include: {
            account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
          },
        },
        costCenter: { include: { budget_plan: true } },
      } as any,
    });

    const rows = txs.map((t: any) => {
      const other = t.counter_transaction ? inferOtherFromAccount(t.counter_transaction.account) : undefined;
      const costCenterLabel = t.costCenter && t.costCenter.budget_plan ? `${t.costCenter.budget_plan.name} - ${t.costCenter.name}` : undefined;
      return {
        date: (t.date_valued || t.date).toISOString(),
        description: t.description,
        reference: t.reference || undefined,
        amount: Number(t.amount), // neu: Betrag
        balanceAfter: Number(t.accountValueAfter),
        other,
        costCenter: costCenterLabel,
      };
    });

    const title = `${titleSubject} — Export`; // Datum wird im PDF-Header ergänzt
    const pdfBuf = await generateTransactionsPdf(title, rows);

    const filenameSafe = titleSubject.replace(/[^\w\s-.]/g, '').replace(/\s+/g, '_');
    const filename = `Export_${filenameSafe}_${new Date().toISOString().slice(0,10)}.pdf`;

    // Buffer -> ArrayBuffer umwandeln (sicher, nicht SharedArrayBuffer)
    const uint8 = new Uint8Array(pdfBuf);
    const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);

    return new NextResponse(arrayBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: 'Fehler beim Erstellen des Exports', detail: e?.message }, { status: 500 });
  }
}
