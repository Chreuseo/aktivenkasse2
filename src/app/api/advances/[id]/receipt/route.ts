import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const advId = Number(id);
  if (!advId || isNaN(advId)) {
    return NextResponse.json({ error: "Ungültige Auslagen-ID" }, { status: 400 });
  }

  const advance = await prisma.advances.findUnique({
    where: { id: advId },
    include: { attachment: true },
  });

  if (!advance || !advance.attachmentId || !advance.attachment) {
    return NextResponse.json({ error: "Kein Beleg für diese Auslage vorhanden." }, { status: 404 });
  }

  const attachment = advance.attachment;
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
