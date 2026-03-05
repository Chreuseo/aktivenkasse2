import type { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path"; // hinzugefügt

// Sicheres, eingeschränktes Upload-Verzeichnis definieren
const UPLOAD_BASE_DIR = path.join(process.cwd(), "uploads_tmp");
try {
    if (!fs.existsSync(UPLOAD_BASE_DIR)) {
        fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
    }
} catch {
    // Falls Verzeichnis nicht erstellt werden kann, formidable nutzt Fallback (OS tmp). Späterer Pfad-Check verhindert Nutzung.
}

export async function resolveAccountId(prisma: PrismaClient, type: string, id: string): Promise<number | null> {
    if (!type || !id) return null;
    if (type === 'user') {
        const user = await prisma.user.findUnique({ where: { id: Number(id) } });
        return user?.accountId || null;
    }
    if (type === 'bank') {
        const bank = await prisma.bankAccount.findUnique({ where: { id: Number(id) } });
        return bank?.accountId || null;
    }
    if (type === 'clearing_account') {
        const ca = await prisma.clearingAccount.findUnique({ where: { id: Number(id) } });
        return ca?.accountId || null;
    }
    return null;
}

export function extractUserFromAuthHeader(authHeader: string | undefined): { userId: string | null; jwt: any } {
  let userId: string | null = null;
  let jwt: any = null;
  if (authHeader) {
    const match = authHeader.match(/^Bearer (.+)$/);
    if (match) {
      const token = match[1];
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const payloadB64Url = parts[1];
          const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/');
          const padLen = (4 - (payloadB64.length % 4)) % 4;
          const padded = payloadB64 + '='.repeat(padLen);
          jwt = JSON.parse(Buffer.from(padded, 'base64').toString());
          userId = jwt?.sub || jwt?.userId || jwt?.id || null;
        }
      } catch {
        // ignore
      }
    }
  }
  return { userId, jwt };
}
