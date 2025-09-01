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
        const result = {
            id: bankAccount.id,
            name: bankAccount.name ?? "",
            bank: bankAccount.bank ?? "",
            iban: bankAccount.iban ?? "",
            bic: bankAccount.bic ?? "",
            balance: typeof bankAccount.account?.balance === "number" ? bankAccount.account.balance : 0,
        };
        // Transaktionen werden für die Detailansicht benötigt, aber nicht für das Edit-Formular
        return NextResponse.json(result);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Bankkontodaten", detail: error?.message }, { status: 500 });
    }
}
