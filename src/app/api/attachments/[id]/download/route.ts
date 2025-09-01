import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const attachmentId = Number(id);
  if (!attachmentId || isNaN(attachmentId)) {
    return NextResponse.json({ error: "Ungültige Attachment-ID" }, { status: 400 });
  }
  // Attachment auslesen
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Beleg nicht gefunden." }, { status: 404 });
  }
  // Datei ausliefern
  return new Response(attachment.data, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename=${attachment.name}`,
    },
  });
}

