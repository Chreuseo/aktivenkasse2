import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

function inferOtherFromAccount(acc: any) {
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
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    // params asynchron auflösen
    const { id: requestedId } = await context.params;
    // Rechtevalidierung für Bankkonto-Detailansicht (Token wird nicht weiter genutzt)

    const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_all);
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_all auf bank_accounts" }, { status: 403 });
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
            balance: typeof bankAccount.account?.balance === "number" ? bankAccount.account.balance : Number(bankAccount.account?.balance || 0),
            payment_method: !!bankAccount.payment_method,
        };
        // Prüfe Query-Parameter
        const url = new URL(req.url);
        const withTransactions = url.searchParams.get("withTransactions") === "true";
        if (!withTransactions) {
            // Nur flaches Objekt zurückgeben
            return NextResponse.json(resultBankAccount);
        }
        // Transaktionen für die Detailansicht (neues Schema)
        const transactionsRaw = await prisma.transaction.findMany({
            where: { accountId: bankAccount.accountId },
            orderBy: { date: "desc" },
            include: {
                counter_transaction: {
                    include: {
                        account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
                    },
                },
                costCenter: { include: { budget_plan: true } },
                attachment: true,
            },
        });
        const transactions = transactionsRaw.map((tx: any) => {
            const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
            const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
            return {
                id: tx.id,
                amount: Number(tx.amount),
                date: (tx.date_valued ?? tx.date).toISOString(),
                description: tx.description,
                reference: tx.reference || undefined,
                other,
                attachmentId: tx.attachmentId || undefined,
                receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
                costCenterLabel,
                bulkId: tx.transactionBulkId ? Number(tx.transactionBulkId) : undefined,
            };
        });
        // Rückgabe im erwarteten Format
        return NextResponse.json({ bankAccount: resultBankAccount, transactions });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Bankkontodaten", detail: error?.message }, { status: 500 });
    }
}
