export async function saveAttachmentFromFormFileData(prisma: any, file: File | null) {
  if (!file) return null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const att = await prisma.attachment.create({
      data: {
        name: (file as any).name || 'Anhang',
        mimeType: file.type || 'application/octet-stream',
        data: buffer,
      },
    });
    return att.id;
  } catch (e) {
    return null;
  }
}

export function firstFieldFromFormData(formData: FormData, keys: string[]) {
  for (const k of keys) {
    const v = formData.get(k);
    if (v == null) continue;
    if (typeof v === 'string') return v;
    // File/Blob -> skip
  }
  return undefined;
}
