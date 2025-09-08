import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { generateTransactionsPdf } from "@/lib/pdf";

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

  if (!type) {
    return NextResponse.json({ error: 'type fehlt' }, { status: 400 });
  }
  const resource = mapTypeToResource(type);
  if (!resource) {
    return NextResponse.json({ error: 'Ungültiger type' }, { status: 400 });
  }

  // Haushalt noch nicht implementiert
  if (resource === ResourceType.budget_plan) {
    return NextResponse.json({ error: 'Export für Haushalt noch nicht implementiert' }, { status: 501 });
  }

  if (!idStr) {
    return NextResponse.json({ error: 'id fehlt' }, { status: 400 });
  }

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

    const filenameSafe = titleSubject.replace(/[^\w\s\-\.]/g, '').replace(/\s+/g, '_');
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
