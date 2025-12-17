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

export async function GET(req: NextRequest, context: any) {
    const id = Number(context.params.id);
    if (!id || isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
    const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_all);
    if (!perm.allowed) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
    const acc = await prisma.bankAccount.findUnique({ where: { id } });
    if (!acc) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    return NextResponse.json(acc);
}
