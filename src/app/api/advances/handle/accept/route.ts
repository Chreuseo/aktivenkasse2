import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { parsePositiveAmount } from '@/lib/validation';
import { checkPermission } from '@/services/authService';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import {clearing_account_roles, getClearingAccountRole} from "@/lib/getUserAuthContext";

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
    const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
    if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body' }, { status: 400 });
  }

  const advId = Number(body?.id || body?.advanceId);
  if (!advId || isNaN(advId)) return NextResponse.json({ error: 'Ungültige Auslage-ID' }, { status: 400 });

  if(advance){
      // Determine attachment: passed override or copy from advance
      const attachmentId = body?.attachmentId ?? advance.attachmentId ?? null;
      const reasonRaw = Object.prototype.hasOwnProperty.call(body, 'reason') ? body.reason : undefined;
      const reason = reasonRaw === undefined ? undefined : String(reasonRaw);
  }
  else{
        return NextResponse.json({ error: 'Auslage nicht gefunden' }, { status: 404 });
  }


  // Amount
  const amountNum = typeof advance.amount === 'number' ? advance.amount : Number(advance.amount);
  if (!isFinite(amountNum)) return NextResponse.json({ error: 'Ungültiger Betrag in Auslage' }, { status: 400 });
  const amt = parsePositiveAmount(amountNum);
  if (amt === null) return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });

  // Resolve accounts
  // account of submitting user
  const submitter = advance.user;
  if (!submitter) return NextResponse.json({ error: 'Einreichender Nutzer nicht gefunden' }, { status: 400 });
  const acc1Id = submitter.accountId;
  if (!acc1Id) return NextResponse.json({ error: 'Account des Einreichenden nicht gefunden' }, { status: 400 });

  const clearingAccountId = body?.clearingAccountId ? Number(body.clearingAccountId) : (advance.clearingAccountId ?? null);
  const costCenterId = body?.costCenterId ? Number(body.costCenterId) : null;

  if (!clearingAccountId && !costCenterId) {
    return NextResponse.json({ error: 'Entweder clearingAccountId oder costCenterId muss angegeben sein' }, { status: 400 });
  }

  // Datum der Advance
    const advance = await prisma.advances.findUnique({ where: { id: advId }, include: { user: true } });
  const reference = "Auslagenabrechnung vom " + advance.date.toISOString().split('T')[0];

  // Berechtigungsprüfung: wenn ein Verrechnungskonto angegeben ist, prüfe Rolle auf diesem Konto
  if (clearingAccountId) {
    const userRole = await getClearingAccountRole(clearingAccountId, String(sub));
    switch (userRole) {
      case clearing_account_roles.none: {
        // Kein Mitglied: benötige globale write-Rechte auf advances
        const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
        if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung auf das angegebene Verrechnungskonto' }, { status: 403 });
        break;
      }
      case clearing_account_roles.responsible: {
          // Verantwortlicher: Prüfe read_own auf clearing_accounts (typischer Check für Zugriffe auf eigene Konten)
          const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
          if (!perm.allowed) return NextResponse.json({error: 'Keine Berechtigung'}, {status: 403});
          break;
      }
      case  clearing_account_roles.member:  {
        const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
        if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung auf das angegebene Verrechnungskonto' }, { status: 403 });
        break;
      }
    }
  } else {
    // Ohne Verrechnungskonto: require global write on advances
    const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
    if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  // Reviewer (current user in token) -> find prisma user
  const reviewer = await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!reviewer) return NextResponse.json({ error: 'Reviewer nicht gefunden' }, { status: 404 });

  const now = new Date();

  try {
    const result = await prisma.$transaction(async (p: any) => {
      // Load account balances
      const acc1 = await p.account.findUnique({ where: { id: acc1Id } });
      const bal1 = acc1 ? Number(acc1.balance) : 0;
      const newBal1 = bal1 + amt; // Auszahlung an Nutzer

      // If clearing account provided -> create countertransaction
      if (clearingAccountId) {
        const clearing = await p.clearingAccount.findUnique({ where: { id: clearingAccountId }, include: { account: true } });
        if (!clearing || !clearing.account) throw new Error('Clearing-Account nicht gefunden');
        const acc2Id = clearing.account.id;
        const acc2 = await p.account.findUnique({ where: { id: acc2Id } });
        const bal2 = acc2 ? Number(acc2.balance) : 0;
        const newBal2 = bal2 - amt; // Gegenkonto reduziert

        // create tx1 (to submitter)
        const tx1 = await p.transaction.create({
          data: {
            amount: amt,
            date: now,
            date_valued: now,
            description: advance.description,
            reference: reference,
            account: { connect: { id: acc1Id } },
            createdBy: { connect: { id: reviewer.id } },
            accountValueAfter: newBal1,
            ...(attachmentId ? { attachment: { connect: { id: Number(attachmentId) } } } : {}),
          },
        });
        await p.account.update({ where: { id: acc1Id }, data: { balance: newBal1 } });

        // create tx2 (from clearing)
        const tx2 = await p.transaction.create({
          data: {
            amount: -amt,
            date: now,
            date_valued: now,
            description: advance.description,
            reference: reference,
            account: { connect: { id: acc2Id } },
            createdBy: { connect: { id: reviewer.id } },
            accountValueAfter: newBal2,
            ...(attachmentId ? { attachment: { connect: { id: Number(attachmentId) } } } : {}),
          },
        });
        await p.account.update({ where: { id: acc2Id }, data: { balance: newBal2 } });

        // link counter transactions
        await p.transaction.update({ where: { id: tx1.id }, data: { counter_transaction: { connect: { id: tx2.id } } } });
        await p.transaction.update({ where: { id: tx2.id }, data: { counter_transaction: { connect: { id: tx1.id } } } });

        // update advance
        await p.advances.update({ where: { id: advance.id }, data: { state: 'accepted', reviewerId: reviewer.id, decidedAt: now, transactionId: tx1.id, ...(reason !== undefined ? { reason } : {}) } });
        return { transactionId: tx1.id };
      }

      // No clearing account -> use costCenter
      // Validate cost center
      const cc = await p.costCenter.findUnique({ where: { id: costCenterId } });
      if (!cc) throw new Error('Kostenstelle nicht gefunden');

      // create single transaction with costCenter
      const tx = await p.transaction.create({
        data: {
          amount: amt,
          date: now,
          date_valued: now,
          description: advance.description,
          reference: reference,
          account: { connect: { id: acc1Id } },
          createdBy: { connect: { id: reviewer.id } },
          accountValueAfter: newBal1,
          ...(attachmentId ? { attachment: { connect: { id: Number(attachmentId) } } } : {}),
          costCenter: { connect: { id: cc.id } },
        },
      });
      await p.account.update({ where: { id: acc1Id }, data: { balance: newBal1 } });

      await p.advances.update({ where: { id: advance.id }, data: { state: 'accepted', reviewerId: reviewer.id, decidedAt: now, transactionId: tx.id, ...(reason !== undefined ? { reason } : {}) } });
      return { transactionId: tx.id };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('Accept advance failed', e);
    return NextResponse.json({ error: e?.message || 'Fehler' }, { status: 500 });
  }
}
