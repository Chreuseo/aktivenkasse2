import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile, firstFieldFromFormData as firstFieldFromForm } from '@/lib/apiHelpers';

export async function PATCH(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
  const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { keycloak_id: String(sub) } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Ungültiger Request-Body' }, { status: 400 });
  }

  const idNum = Number(body?.id);
  const action = String(body?.action || '');
  if (!idNum || !Number.isFinite(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Ungültige ID' }, { status: 400 });
  }
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Ungültige Aktion' }, { status: 400 });
  }

  const adv = await prisma.advances.findUnique({ where: { id: idNum }, select: { id: true, state: true, userId: true } });
  if (!adv) return NextResponse.json({ error: 'Auslage nicht gefunden' }, { status: 404 });
  if (adv.userId !== user.id) return NextResponse.json({ error: 'Nicht erlaubt' }, { status: 403 });
  if (adv.state !== 'open') return NextResponse.json({ error: 'Nur offene Auslagen können abgebrochen werden' }, { status: 400 });

  await prisma.advances.update({ where: { id: idNum }, data: { state: 'cancelled' } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { jwt } = extractUserFromAuthHeader(authHeader as string | undefined);
  const sub = jwt?.sub || jwt?.userId || jwt?.id || null;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { keycloak_id: String(sub) } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return NextResponse.json({ error: 'Fehler beim Parsen der Formulardaten', detail: e?.message }, { status: 400 });
  }

  const descriptionRaw = firstFieldFromForm(formData, ['description']);
  const dateAdvanceRaw = firstFieldFromForm(formData, ['date_advance', 'auslagedatum']);
  const amountRaw = firstFieldFromForm(formData, ['amount']);
  const clearingAccountIdRaw = firstFieldFromForm(formData, ['clearingAccountId']) || '';

  if (!descriptionRaw || !dateAdvanceRaw) {
    return NextResponse.json({ error: 'Beschreibung und Auslagedatum sind erforderlich' }, { status: 400 });
  }

  const dateAdvance = new Date(dateAdvanceRaw);
  if (isNaN(dateAdvance.getTime())) {
    return NextResponse.json({ error: 'Ungültiges Auslagedatum' }, { status: 400 });
  }

  if (!amountRaw) {
    return NextResponse.json({ error: 'Betrag ist erforderlich' }, { status: 400 });
  }
  const amountStr = amountRaw.replace(',', '.');
  const amountNum = Number(amountStr);
  if (!isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Betrag muss größer als 0 sein' }, { status: 400 });
  }
  const amountDecimal = new Prisma.Decimal(amountStr);

  let clearingAccountIdNum: number | null = null;
  if (clearingAccountIdRaw !== '') {
    const num = Number(clearingAccountIdRaw);
    if (isNaN(num) || num <= 0) {
      return NextResponse.json({ error: 'Ungültiges Verrechnungskonto' }, { status: 400 });
    }
    const clearingAccount = await prisma.clearingAccount.findUnique({ where: { id: num } });
    if (!clearingAccount) {
      return NextResponse.json({ error: 'Verrechnungskonto nicht gefunden' }, { status: 404 });
    }
    clearingAccountIdNum = num;
  }

  const fileField = formData.get('file') ?? formData.get('beleg') ?? formData.get('attachment');
  const firstFile = fileField && typeof fileField !== 'string' ? (fileField as File) : null;
  const attachmentId = firstFile ? await saveAttachmentFromFormFile(prisma as any, firstFile) : null;

  const data: any = {
    amount: amountDecimal,
    description: descriptionRaw,
    date_advance: dateAdvance,
    userId: user.id,
    clearingAccountId: clearingAccountIdNum,
    attachmentId: attachmentId || undefined,
  };

  const advance = await prisma.advances.create({ data });
  return NextResponse.json({ id: advance.id }, { status: 201 });
}
