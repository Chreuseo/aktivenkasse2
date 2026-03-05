import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { saveAttachmentFromFormFileData as saveAttachmentFromFormFile } from '@/lib/apiHelpers';
import { extractTokenAndUserId } from '@/services/authService';

export async function POST(req: Request) {
  // Authentifizierung prüfen (zentral über authService)
  const { userId } = extractTokenAndUserId(req as any);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: 'Fehler beim Parsen der Formulardaten' }, { status: 400 });
  }

  // Unterstütze mehrere Schlüsselnamen, analog zu /api/advances
  const fileField = formData.get('file') ?? formData.get('beleg') ?? formData.get('attachment');
  const firstFile = fileField && typeof fileField !== 'string' ? (fileField as File) : null;
  if (!firstFile) {
    return NextResponse.json({ error: 'Keine Datei übermittelt' }, { status: 400 });
  }

  const attachmentId = await saveAttachmentFromFormFile(prisma, firstFile);
  if (!attachmentId) {
    return NextResponse.json({ error: 'Datei konnte nicht gespeichert werden' }, { status: 500 });
  }

  return NextResponse.json({ id: attachmentId }, { status: 201 });
}
