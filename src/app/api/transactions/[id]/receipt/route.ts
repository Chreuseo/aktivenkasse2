import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, context: any) {
  const id = context?.params?.id as string;
  const txId = Number(id);
  if (!txId || isNaN(txId)) {
    return NextResponse.json({ error: "Ungültige Transaktions-ID" }, { status: 400 });
  }
  // Transaktion auslesen
  const transaction = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { attachment: true },
  });
  if (!transaction || !transaction.attachmentId || !transaction.attachment) {
    return NextResponse.json({ error: "Kein Beleg für diese Transaktion vorhanden." }, { status: 404 });
  }
  // Attachment auslesen und inline liefern
  const attachment = transaction.attachment;
  const mime = attachment.mimeType || "application/octet-stream";
  const u8 = attachment.data as unknown as Uint8Array;
  const copied = u8.slice();
  const ab: ArrayBuffer = copied.buffer;
  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename=${attachment.name}`,
    },
  });
}
