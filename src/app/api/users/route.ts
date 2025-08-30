// src/app/api/users/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
    try {
        const body = await req.json();

        const { first_name, last_name, mail, keycloak_id } = body;

        if (!first_name || !last_name || !mail || !keycloak_id) {
            return NextResponse.json({ error: "Fehlende Felder" }, { status: 400 });
        }

        // Zuerst ein Account anlegen (Domain-Modell)
        const account = await prisma.Account.create({
            data: {
                balance: 0,
                interest: true,
                type: "user",
            },
        });

        // Dann den User anlegen und auf das Account verweisen
        const user = await prisma.User.create({
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