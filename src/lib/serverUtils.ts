import formidable from "formidable";
import type { NextApiRequest } from "next";
import { jwtDecode } from "jwt-decode";
import type { PrismaClient } from "@prisma/client";
import fs from "fs";

// Variante für NextApiRequest (pages/api)
export async function parseMultipartFormDataFromNextApi(req: NextApiRequest): Promise<{ fields: Record<string, any>, files: Record<string, { filename?: string, mimetype?: string, size?: number, filepath: string }> }> {
    return new Promise((resolve, reject) => {
        const form = formidable({ multiples: true });
        form.parse(req as any, (err, fields, files) => {
            if (err) return reject(err);
            const normFields: Record<string, any> = {};
            Object.keys(fields).forEach(key => {
                normFields[key] = Array.isArray((fields as any)[key]) ? (fields as any)[key][0] : (fields as any)[key];
            });
            const normFiles: Record<string, any> = {};
            Object.keys(files).forEach(key => {
                const file: any = Array.isArray((files as any)[key]) ? (files as any)[key][0] : (files as any)[key];
                if (file && file.filepath) {
                    normFiles[key] = {
                        filename: file.originalFilename || file.newFilename || file.name,
                        mimetype: file.mimetype,
                        size: file.size,
                        filepath: file.filepath,
                    };
                }
            });
            resolve({ fields: normFields, files: normFiles });
        });
    });
}

export function extractUserFromAuthHeader(authHeader: string | undefined): { userId: string | null, jwt: any } {
    let userId: string | null = null;
    let jwt: any = null;
    if (authHeader) {
        const match = authHeader.match(/^Bearer (.+)$/);
        if (match) {
            const token = match[1];
            try {
                jwt = jwtDecode(token);
                userId = (jwt as any).sub || (jwt as any).userId || (jwt as any).id || null;
            } catch {}
        }
    }
    return { userId, jwt };
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

export async function saveAttachmentFromTempFile(prisma: PrismaClient, file: { filepath: string, filename?: string, mimetype?: string }): Promise<number | null> {
    if (!file || !file.filepath) return null;
    let fileBuffer: Buffer | null = null;
    try {
        fileBuffer = fs.readFileSync(file.filepath);
    } catch {}
    if (!fileBuffer) return null;
    const att = await prisma.attachment.create({
        data: {
            name: file.filename || 'Anhang',
            mimeType: file.mimetype || 'application/octet-stream',
            data: fileBuffer,
        },
    });
    return att.id;
}
