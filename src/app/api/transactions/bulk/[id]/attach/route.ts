import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { checkPermission } from '@/services/authService';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';
import { isAllowedAttachment } from '@/lib/validation';
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bulkId = Number(id);
  if (!bulkId || isNaN(bulkId)) {
    return NextResponse.json({ error: 'Ungültige Sammeltransaktions-ID' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }

  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return NextResponse.json({ error: 'Fehler beim Parsen der Formulardaten', detail: e?.message }, { status: 400 });
  }

  const fileField = formData.get('attachment') ?? formData.get('file') ?? formData.get('beleg');
  const file = fileField && typeof fileField !== 'string' ? (fileField as File) : null;
  if (!file) {
    return NextResponse.json({ error: 'Keine Datei übermittelt' }, { status: 400 });
  }
  if (!isAllowedAttachment((file as any).type)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt (nur Bilder oder PDF)' }, { status: 400 });
  }

  const bulk: any = await prisma.transactionBulk.findUnique({
    where: { id: bulkId },
    include: { mainTransaction: true, transactions: true },
  } as any);
  if (!bulk) {
    return NextResponse.json({ error: 'Sammeltransaktion nicht gefunden' }, { status: 404 });
  }

  const attachmentId = await saveAttachmentFromFormFile(prisma as any, file);
  if (!attachmentId) {
    return NextResponse.json({ error: 'Beleg konnte nicht gespeichert werden' }, { status: 500 });
  }

  try {
    await prisma.$transaction(async (p: any) => {
      await p.transactionBulk.update({ where: { id: bulkId }, data: { attachment: { connect: { id: attachmentId } } } });
      const mainTxId = bulk.mainTransaction?.id || bulk.transactionId || null;
      if (mainTxId) {
        await p.transaction.update({ where: { id: mainTxId }, data: { attachment: { connect: { id: attachmentId } } } });
      }
      if (Array.isArray(bulk.transactions)) {
        for (const t of bulk.transactions) {
          await p.transaction.update({ where: { id: t.id }, data: { attachment: { connect: { id: attachmentId } } } });
        }
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Fehler beim Speichern des Belegs' }, { status: 500 });
  }

  const updatedTransactions = (Array.isArray(bulk.transactions) ? bulk.transactions.length : 0) + (bulk.mainTransaction || bulk.transactionId ? 1 : 0);
  return NextResponse.json({ bulkId, attachmentId, updatedTransactions }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
