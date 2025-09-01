import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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
  // Attachment auslesen
  const attachment = transaction.attachment;
  return new Response(attachment.data, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename=${attachment.name}`,
    },
  });
}
