import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import formidable, { File as FormidableFile, Fields, Files } from "formidable";
import { promises as fs } from "fs";
import { Prisma } from "@prisma/client";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "20mb",
  },
};

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  const form = formidable({ multiples: false, allowEmptyFiles: false, maxFileSize: 20 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function firstField(value: any): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value[0];
  return String(value);
}

function decodeJwtSub(authHeader?: string | string[]): string | null {
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  try {
    const token = m[1];
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Nutzer ermitteln (Keycloak-ID im JWT)
  const sub = decodeJwtSub(req.headers.authorization as any || (req.headers as any)["Authorization"]);
  if (!sub) return res.status(401).json({ error: "Unauthorized" });

  const user = await prisma.user.findUnique({ where: { keycloak_id: sub } });
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const { fields, files } = await parseForm(req);

    const descriptionRaw = firstField((fields as any).description)?.trim();
    const dateAdvanceRaw = (firstField((fields as any).date_advance) || firstField((fields as any).auslagedatum))?.trim();
    const amountRaw = firstField((fields as any).amount)?.trim();
    const clearingAccountIdRaw = firstField((fields as any).clearingAccountId) || "";

    if (!descriptionRaw || !dateAdvanceRaw) {
      return res.status(400).json({ error: "Beschreibung und Auslagedatum sind erforderlich" });
    }

    const dateAdvance = new Date(dateAdvanceRaw);
    if (isNaN(dateAdvance.getTime())) {
      return res.status(400).json({ error: "Ungültiges Auslagedatum" });
    }

    if (!amountRaw) {
      return res.status(400).json({ error: "Betrag ist erforderlich" });
    }
    const amountStr = amountRaw.replace(",", ".");
    const amountNum = Number(amountStr);
    if (!isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "Betrag muss größer als 0 sein" });
    }
    const amountDecimal = new Prisma.Decimal(amountStr);

    let clearingAccountIdNum: number | null = null;
    if (clearingAccountIdRaw !== "") {
      const num = Number(clearingAccountIdRaw);
      if (isNaN(num) || num <= 0) {
        return res.status(400).json({ error: "Ungültiges Verrechnungskonto" });
      }
      const clearingAccount = await prisma.clearingAccount.findUnique({ where: { id: num } });
      if (!clearingAccount) {
        return res.status(404).json({ error: "Verrechnungskonto nicht gefunden" });
      }
      clearingAccountIdNum = num;
    }

    // Optionalen Beleg als Attachment speichern
    let attachmentId: number | null = null;
    const fileField = (files as any).file || (files as any).beleg || (files as any).attachment;
    const firstFile: FormidableFile | undefined = Array.isArray(fileField) ? fileField[0] : (fileField as any);

    if (firstFile && (firstFile as any).filepath) {
      const buf = await fs.readFile((firstFile as any).filepath);
      const name = firstFile.originalFilename || "upload";
      const mime = firstFile.mimetype || "application/octet-stream";
      const att = await prisma.attachment.create({
        data: { name, mimeType: mime, data: buf },
      });
      attachmentId = att.id;
    }

    const data: any = {
      amount: amountDecimal,
      description: descriptionRaw,
      date_advance: dateAdvance,
      userId: user.id,
      clearingAccountId: clearingAccountIdNum,
      attachmentId: attachmentId || undefined,
    };

    const advance = await prisma.advances.create({ data });

    return res.status(201).json({ id: advance.id });
  } catch (e: any) {
    console.error("/api/advances error:", e);
    return res.status(500).json({ error: e?.message || "Serverfehler" });
  }
}
