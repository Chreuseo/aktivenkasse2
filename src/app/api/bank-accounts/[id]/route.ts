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
        // Flaches Objekt für Edit-Formular
        const resultBankAccount = {
            id: bankAccount.id,
            name: bankAccount.name ?? "",
            bank: bankAccount.bank ?? "",
            iban: bankAccount.iban ?? "",
            bic: bankAccount.bic ?? "",
            balance: typeof bankAccount.account?.balance === "number" ? bankAccount.account.balance : 0,
        };
        // Prüfe Query-Parameter
        const url = new URL(req.url);
        const withTransactions = url.searchParams.get("withTransactions") === "true";
        if (!withTransactions) {
            // Nur flaches Objekt zurückgeben
            return NextResponse.json(resultBankAccount);
        }
        // Transaktionen für die Detailansicht
        const transactionsRaw = await prisma.transaction.findMany({
            where: {
                OR: [
                    { accountId1: bankAccount.accountId },
                    { accountId2: bankAccount.accountId },
                ],
            },
            orderBy: { date: "desc" },
            include: {
                account1: {
                    include: {
                        users: true,
                        bankAccounts: true,
                        clearingAccounts: true,
                    },
                },
                account2: {
                    include: {
                        users: true,
                        bankAccounts: true,
                        clearingAccounts: true,
                    },
                },
            },
        });
        const transactions = transactionsRaw.map(tx => {
            const isMain = tx.accountId1 === bankAccount.accountId;
            const amount = isMain ? (tx.account1Negative ? -Number(tx.amount) : Number(tx.amount)) : (tx.account2Negative ? -Number(tx.amount) : Number(tx.amount));
            const otherAccount = isMain ? tx.account2 : tx.account1;
            let otherDetails = null;
            if (otherAccount) {
                if (otherAccount.type === "user" && otherAccount.users?.length) {
                    otherDetails = {
                        type: "user",
                        name: otherAccount.users[0].first_name + " " + otherAccount.users[0].last_name,
                        mail: otherAccount.users[0].mail,
                    };
                } else if (otherAccount.type === "bank" && otherAccount.bankAccounts?.length) {
                    otherDetails = {
                        type: "bank",
                        name: otherAccount.bankAccounts[0].name,
                        bank: otherAccount.bankAccounts[0].bank,
                        iban: otherAccount.bankAccounts[0].iban,
                    };
                } else if (otherAccount.type === "clearing_account" && otherAccount.clearingAccounts?.length) {
                    otherDetails = {
                        type: "clearing_account",
                        name: otherAccount.clearingAccounts[0].name,
                    };
                }
            }
            return {
                id: tx.id,
                amount,
                date: tx.date.toISOString(),
                description: tx.description,
                reference: tx.reference || undefined,
                other: otherDetails,
            };
        });
        // Rückgabe im erwarteten Format
        return NextResponse.json({ bankAccount: resultBankAccount, transactions });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Bankkontodaten", detail: error?.message }, { status: 500 });
    }
}
