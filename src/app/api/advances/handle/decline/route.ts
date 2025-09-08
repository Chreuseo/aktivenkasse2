import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { checkPermission } from '@/services/authService';
import { ResourceType, AuthorizationType } from '@/app/types/authorization';
import {clearing_account_roles, getClearingAccountRole} from "@/lib/getUserAuthContext";
import { sendPlainMail } from '@/services/mailService';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sub = userId; // Keycloak-ID aus JWT

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body' }, { status: 400 });
  }

  const advId = Number(body?.id || body?.advanceId);
  if (!advId || isNaN(advId)) return NextResponse.json({ error: 'Ungültige Auslage-ID' }, { status: 400 });

  const advance = await prisma.advances.findUnique({ where: { id: advId }, include: { user: true } });
  if (!advance) return NextResponse.json({ error: 'Auslage nicht gefunden' }, { status: 404 });

    if (advance.state !== 'open') {
        return NextResponse.json({ error: 'Auslage kann in diesem Zustand nicht abgelehnt werden' }, { status: 400 });
    }

    // Ziel-Konten aus Body oder Advance
    const clearingAccountId = body?.clearingAccountId ? Number(body.clearingAccountId) : (advance.clearingAccountId ?? null);

    // Berechtigungsprüfung
    if (clearingAccountId) {
        const userRole = await getClearingAccountRole(clearingAccountId, String(sub));
        switch (userRole) {
            case clearing_account_roles.none: {
                const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
                if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung auf das angegebene Verrechnungskonto' }, { status: 403 });
                break;
            }
            case clearing_account_roles.responsible: {
                const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_own);
                if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
                break;
            }
            case clearing_account_roles.member: {
                const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
                if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung auf das angegebene Verrechnungskonto' }, { status: 403 });
                break;
            }
        }
    } else {
        const perm = await checkPermission(req, ResourceType.advances, AuthorizationType.write_all);
        if (!perm.allowed) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
    }

  const reviewer = await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!reviewer) return NextResponse.json({ error: 'Reviewer nicht gefunden' }, { status: 404 });

  const now = new Date();
  const reasonRaw = body?.reason;
  if (reasonRaw === undefined || reasonRaw === null || String(reasonRaw).trim() === '') {
    return NextResponse.json({ error: 'Begründung ist erforderlich' }, { status: 400 });
  }
  const reason = String(reasonRaw);

  try {
    await prisma.advances.update({ where: { id: advId }, data: { state: 'rejected', reviewerId: reviewer.id, decidedAt: now, reason: reason } });

    // Nicht-blockierend: Mail an Einreicher senden
    (async () => {
      try {
        const submitter = advance.user;
        if (submitter?.mail) {
          const initiatorName = `${reviewer.first_name} ${reviewer.last_name}`;
          const initiatorEmail = reviewer.mail;
          const d: any = (advance as any).date_advance || advance.date;
          const dateFmt = new Date(d).toISOString().slice(0, 10);
          const amountNum = typeof advance.amount === 'number' ? advance.amount : Number(advance.amount);
          const amountFmt = Number(amountNum).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
          const text = [
            `Hallo ${submitter.first_name} ${submitter.last_name},`,
            '',
            'deine Auslage wurde abgelehnt.',
            '',
            'Details:',
            `• Betrag: ${amountFmt}`,
            `• Datum: ${dateFmt}`,
            `• Beschreibung: ${advance.description}`,
            `• Begründung: ${reason}`,
          ].join('\n');
          await sendPlainMail({
            to: submitter.mail,
            subject: `Auslage abgelehnt (ID ${advance.id})`,
            text,
            initiatorName,
            initiatorEmail,
            recipientUserId: submitter.id,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Send decline mail failed', e);
      }
    })();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Decline advance failed', e);
    return NextResponse.json({ error: 'Fehler beim Ablehnen' }, { status: 500 });
  }
}
