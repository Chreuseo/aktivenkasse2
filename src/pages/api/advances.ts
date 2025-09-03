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

function parseJsonBody(req: NextApiRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function firstField(value: string | string[] | undefined | null): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : String(value);
}

function firstFileFromFiles(files: Files, keys: string[]): FormidableFile | undefined {
  for (const key of keys) {
    const v = files[key];
    if (!v) continue;
    return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
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
  const method = req.method || "GET";

  const authHeader = (req.headers["authorization"] ?? req.headers["Authorization"]) as string | string[] | undefined;
  const sub = decodeJwtSub(authHeader);
  if (!sub) return res.status(401).json({ error: "Unauthorized" });
  const user = await prisma.user.findUnique({ where: { keycloak_id: sub } });
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    if (method === "GET") {
      const advances = await prisma.advances.findMany({
        where: { user: { accountId: user.accountId } },
        orderBy: { date_advance: "desc" },
        select: {
          id: true,
          date_advance: true,
          description: true,
          amount: true,
          state: true,
          attachmentId: true,
          clearingAccount: { select: { id: true, name: true } },
          reviewer: { select: { first_name: true, last_name: true } },
          userId: true,
        },
      });
      const items = advances.map(a => ({
        id: a.id,
        date_advance: a.date_advance.toISOString(),
        description: a.description,
        amount: (a.amount as Prisma.Decimal).toString(),
        state: a.state,
        attachmentId: a.attachmentId,
        clearingAccount: a.clearingAccount ? { id: a.clearingAccount.id, name: a.clearingAccount.name } : null,
        reviewer: a.reviewer ? { first_name: a.reviewer.first_name, last_name: a.reviewer.last_name } : null,
        canCancel: a.state === "open" && a.userId === user.id,
        receiptUrl: a.attachmentId ? `/api/advances/${a.id}/receipt` : undefined,
      }));
      return res.status(200).json({ items });
    }

    if (method === "PATCH") {
      const body = (await parseJsonBody(req)) as { id?: number | string; action?: string };
      const idNum = Number(body?.id);
      const action = String(body?.action || "");
      if (!idNum || !Number.isFinite(idNum) || idNum <= 0) {
        return res.status(400).json({ error: "Ungültige ID" });
      }
      if (action !== "cancel") {
        return res.status(400).json({ error: "Ungültige Aktion" });
      }
      const adv = await prisma.advances.findUnique({
        where: { id: idNum },
        select: { id: true, state: true, userId: true },
      });
      if (!adv) return res.status(404).json({ error: "Auslage nicht gefunden" });
      if (adv.userId !== user.id) return res.status(403).json({ error: "Nicht erlaubt" });
      if (adv.state !== "open") return res.status(400).json({ error: "Nur offene Auslagen können abgebrochen werden" });

      await prisma.advances.update({ where: { id: idNum }, data: { state: "cancelled" } });
      return res.status(200).json({ ok: true });
    }

    if (method === "POST") {
      const { fields, files } = await parseForm(req);

      const descriptionRaw = firstField(fields["description"])?.trim();
      const dateAdvanceRaw = (firstField(fields["date_advance"]) || firstField(fields["auslagedatum"]))?.trim();
      const amountRaw = firstField(fields["amount"])?.trim();
      const clearingAccountIdRaw = firstField(fields["clearingAccountId"]) || "";

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
        if (clearingAccount.accountId !== user.accountId) {
          return res.status(403).json({ error: "Verrechnungskonto gehört nicht zu Ihrem Account" });
        }
        clearingAccountIdNum = num;
      }

      let attachmentId: number | null = null;
      const firstFile = firstFileFromFiles(files, ["file", "beleg", "attachment"]);

      if (firstFile && firstFile.filepath) {
        const buf = await fs.readFile(firstFile.filepath);
        const name = firstFile.originalFilename || "upload";
        const mime = firstFile.mimetype || "application/octet-stream";
        const att = await prisma.attachment.create({
          data: { name, mimeType: mime, data: buf },
        });
        attachmentId = att.id;
      }

      const data = {
        amount: amountDecimal,
        description: descriptionRaw,
        date_advance: dateAdvance,
        userId: user.id,
        clearingAccountId: clearingAccountIdNum,
        attachmentId: attachmentId || undefined,
      };

      const advance = await prisma.advances.create({ data });

      return res.status(201).json({ id: advance.id });
    }

    res.setHeader("Allow", "GET,POST,PATCH");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("/api/advances error:", e);
    return res.status(500).json({ error: message || "Serverfehler" });
  }
}
