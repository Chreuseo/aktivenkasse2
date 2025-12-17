import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest, context: any) {
  const { id } = context.params;
  const txId = Number(id);
  if (!txId || isNaN(txId)) return NextResponse.json({ error: 'Ungültige Transaktions-ID' }, { status: 400 });
  const tx = await prisma.transaction.findUnique({ where: { id: txId }, select: { attachmentId: true } });
  if (!tx?.attachmentId) return NextResponse.json({ error: 'Kein Beleg vorhanden' }, { status: 404 });
  return NextResponse.redirect(new URL(`/api/attachments/${tx.attachmentId}/download`, req.url));
}
