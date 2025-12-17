import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { extractUserFromAuthHeader } from '@/lib/serverUtils';
import { checkPermission } from '@/services/authService';
import { AuthorizationType, ResourceType } from '@/app/types/authorization';
import { isAllowedAttachment } from '@/lib/validation';
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';

export async function POST(req: Request, context: any) {
  const { id } = context.params;
  const txId = Number(id);
  if (!txId || isNaN(txId)) {
    return NextResponse.json({ error: 'Ungültige Transaktions-ID' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || undefined;
  const { userId } = extractUserFromAuthHeader(authHeader as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: 'Keine UserId im Token' }, { status: 403 });
  }
  const perm = await checkPermission(req as any, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Keine Berechtigung für write_all auf transactions' }, { status: 403 });
  }
  let formData: FormData;
  try {
    formData = await (req as any).formData();
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
  const tx = await prisma.transaction.findUnique({ where: { id: txId }, select: { id: true } });
  if (!tx) {
    return NextResponse.json({ error: 'Transaktion nicht gefunden' }, { status: 404 });
  }
  const attachmentId = await saveAttachmentFromFormFile(prisma as any, file);
  if (!attachmentId) {
    return NextResponse.json({ error: 'Beleg konnte nicht gespeichert werden' }, { status: 500 });
  }
  try {
    await prisma.transaction.update({ where: { id: txId }, data: { attachment: { connect: { id: attachmentId } } } });
  } catch (e: any) {
    return NextResponse.json({ error: 'Fehler beim Speichern des Belegs' }, { status: 500 });
  }
  return NextResponse.json({ id: txId, attachmentId }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
