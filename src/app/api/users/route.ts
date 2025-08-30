import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
    try {
        const body = await req.json();

        const { first_name, last_name, mail, keycloak_id } = body;

        if (!first_name || !last_name || !mail || !keycloak_id) {
            return NextResponse.json({ error: "Fehlende Felder" }, { status: 400 });
        }

        // Zuerst ein LedgerAccount anlegen (Domain-Modell)
        const account = await prisma.ledgerAccount.create({
            data: {
                balance: 0,
                interest: false,
                type: "user",
            },
        });

        // Dann den User anlegen und auf das LedgerAccount verweisen
        const user = await prisma.user.create({
            data: {
                first_name,
                last_name,
                mail,
                keycloak_id,
                accountId: account.id,
            },
        });

        return NextResponse.json(user, { status: 201 });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Anlegen des Nutzers" }, { status: 500 });
    }
}