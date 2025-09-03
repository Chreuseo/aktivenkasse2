import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
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
  const blob = new Blob([attachment.data], { type: mime });
  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename=${attachment.name}`,
    },
  });
}
