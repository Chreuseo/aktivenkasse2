import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    // Rechtevalidierung für Nutzer-Detailansicht
    const { userId: tokenUserId } = extractTokenAndUserId(req);
    const requestedId = params.id;
    let requiredPermission = AuthorizationType.read_all;
    if (tokenUserId && (requestedId === tokenUserId || requestedId === String(tokenUserId))) {
        requiredPermission = AuthorizationType.read_own;
    }
    const perm = await checkPermission(req, ResourceType.userAuth, requiredPermission);
    if (!perm.allowed) {
        return NextResponse.json({ error: `Keine Berechtigung für ${requiredPermission} auf userAuth` }, { status: 403 });
    }
    try {
        const userId = Number(params.id);
        if (!userId || isNaN(userId)) {
            return NextResponse.json({ error: "Ungültige Nutzer-ID" }, { status: 400 });
        }
        // User inkl. Account und Kontostand
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { account: true },
        });
        if (!user) {
            return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
        }
        // Alle Transaktionen des Accounts nach neuem Schema
        const accountId = user.accountId;
        const transactionsRaw = await prisma.transaction.findMany({
            where: { accountId },
            orderBy: { date: "desc" },
            include: {
                counter_transaction: {
                    include: {
                        account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
                    },
                },
            },
        });
        // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
        const txs = transactionsRaw.map((tx: any) => {
            const other = tx.counter_transaction ? (() => {
                const acc = tx.counter_transaction.account;
                if (!acc) return null;
                if (acc.users && acc.users.length > 0) {
                    const u = acc.users[0];
                    return { type: "user", name: `${u.first_name} ${u.last_name}`, mail: u.mail };
                }
                if (acc.bankAccounts && acc.bankAccounts.length > 0) {
                    const b = acc.bankAccounts[0];
                    return { type: "bank", name: b.name, bank: b.bank, iban: b.iban };
                }
                if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
                    const c = acc.clearingAccounts[0];
                    return { type: "clearing_account", name: c.name };
                }
                return null;
            })() : null;
            return {
                id: tx.id,
                amount: Number(tx.amount),
                date: (tx.date_valued ?? tx.date).toISOString(),
                description: tx.description,
                reference: tx.reference || undefined,
                other,
                attachmentId: tx.attachmentId || undefined,
                receiptUrl: tx.attachmentId ? `/api/attachments/${tx.attachmentId}/download` : undefined,
            };
        });
        return NextResponse.json({
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                mail: user.mail,
                balance: user.account?.balance ? Number(user.account.balance) : 0,
            },
            transactions: txs,
        });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Nutzerdaten", detail: error?.message }, { status: 500 });
    }
}
