import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_req: Request, { params }: any) {
  const attachmentId = Number(params.id);
  if (!attachmentId || isNaN(attachmentId)) {
    return NextResponse.json({ error: "Ungültige Attachment-ID" }, { status: 400 });
  }
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) {
    return NextResponse.json({ error: "Beleg nicht gefunden." }, { status: 404 });
  }
  const u8 = attachment.data as unknown as Uint8Array;
  const copied = u8.slice();
  const ab: ArrayBuffer = copied.buffer;
  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename=${attachment.name}`,
    },
  });
}
