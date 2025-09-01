import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission, extractTokenAndUserId } from "@/services/authService";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
    // params asynchron auflösen
    const { id: requestedId } = await context.params;
    // Rechtevalidierung für Bankkonto-Detailansicht
    const { userId: tokenUserId } = extractTokenAndUserId(req);
    let requiredPermission = AuthorizationType.read_all;
    // Prüfe, ob das Konto "eigen" ist (über Nutzer-Account-Verknüpfung)
    let isOwn = false;
    if (tokenUserId && !isNaN(Number(tokenUserId))) {
        const user = await prisma.user.findUnique({
            where: { id: Number(tokenUserId) },
            include: { account: true },
        });
        if (user?.accountId && String(user.accountId) === requestedId) {
            requiredPermission = AuthorizationType.read_own;
            isOwn = true;
        }
    }
    // Logging für Debug
    console.log("BankAccount-API: requestedId=", requestedId, "tokenUserId=", tokenUserId, "requiredPermission=", requiredPermission);
    const perm = await checkPermission(req, ResourceType.bank_accounts, requiredPermission);
    console.log("BankAccount-API: checkPermission result=", perm);
    if (!perm.allowed) {
        return NextResponse.json({ error: `Keine Berechtigung für ${requiredPermission} auf bankAccount`, debug: perm }, { status: 403 });
    }
    try {
        const bankAccountId = Number(requestedId);
        if (!bankAccountId || isNaN(bankAccountId)) {
            return NextResponse.json({ error: "Ungültige Bankkonto-ID" }, { status: 400 });
        }
        // Bankkonto inkl. Saldo
        const bankAccount = await prisma.bankAccount.findUnique({
            where: { id: bankAccountId },
            include: { account: true },
        });
        if (!bankAccount) {
            return NextResponse.json({ error: "Bankkonto nicht gefunden" }, { status: 404 });
        }
        // Alle Transaktionen des Kontos (als account1 oder account2)
        const accountId = bankAccount.accountId;
        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [
                    { accountId1: accountId },
                    { accountId2: accountId },
                ],
            },
            orderBy: { date: "desc" },
            include: {
                account1: {
                    include: {
                        users: true,
                        bankAccounts: true,
                    },
                },
                account2: {
                    include: {
                        users: true,
                        bankAccounts: true,
                    },
                },
            },
        });
        // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
        const txs = transactions.map(tx => {
            let isMain = tx.accountId1 === accountId;
            let amount = isMain ? (tx.account1Negative ? -tx.amount : tx.amount) : (tx.account2Negative ? -tx.amount : tx.amount);
            let otherAccount = isMain ? tx.account2 : tx.account1;
            let otherType = otherAccount?.type;
            let otherDetails = null;
            if (otherAccount) {
                if (otherType === "user" && otherAccount.users?.length) {
                    otherDetails = {
                        type: "user",
                        name: otherAccount.users[0].first_name + " " + otherAccount.users[0].last_name,
                        mail: otherAccount.users[0].mail,
                    };
                } else if (otherType === "bank" && otherAccount.bankAccounts?.length) {
                    otherDetails = {
                        type: "bank",
                        name: otherAccount.bankAccounts[0].name,
                        bank: otherAccount.bankAccounts[0].bank,
                        iban: otherAccount.bankAccounts[0].iban,
                    };
                } else if (otherType === "clearing_account") {
                    otherDetails = {
                        type: "clearing_account",
                        name: "Verrechnungskonto",
                    };
                }
            }
            return {
                id: tx.id,
                amount: typeof tx.amount === "object" ? Number(amount) : amount,
                date: tx.date,
                description: tx.description,
                reference: tx.reference,
                other: otherDetails,
            };
        });
        return NextResponse.json({
            bankAccount: {
                id: bankAccount.id,
                name: bankAccount.name,
                bank: bankAccount.bank,
                iban: bankAccount.iban,
                balance: bankAccount.account?.balance ? Number(bankAccount.account.balance) : 0,
            },
            transactions: txs,
        });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Bankkontodaten", detail: error?.message }, { status: 500 });
    }
}
