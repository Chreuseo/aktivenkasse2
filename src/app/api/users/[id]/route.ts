import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const userId = Number(params.id);
        if (!userId || isNaN(userId)) {
            return NextResponse.json({ error: "Ungültige Nutzer-ID" }, { status: 400 });
        }

        // User inkl. Account und Kontostand
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                account: true,
            },
        });
        if (!user) {
            return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
        }

        // Alle Transaktionen des Accounts (als account1 oder account2)
        const accountId = user.accountId;
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
                        helpAccounts: true,
                    },
                },
                account2: {
                    include: {
                        users: true,
                        bankAccounts: true,
                        helpAccounts: true,
                    },
                },
            },
        });

        // Für jede Transaktion: Gegenkonto bestimmen und Details extrahieren
        const txs = transactions.map(tx => {
            // Aus Sicht des Accounts: Betrag und Richtung
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
                } else if (otherType === "help_account" && otherAccount.helpAccounts?.length) {
                    otherDetails = {
                        type: "help_account",
                        name: otherAccount.helpAccounts[0].name,
                    };
                }
            }
            return {
                id: tx.id,
                amount: amount,
                date: tx.date,
                description: tx.description,
                reference: tx.reference,
                other: otherDetails,
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
            transactions: txs.map(tx => ({
                ...tx,
                amount: typeof tx.amount === "object" ? Number(tx.amount) : tx.amount
            })),
        });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Nutzerdaten", detail: error?.message }, { status: 500 });
    }
}
