// typescript
// Datei: `src/app/api/users/route.ts`
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";
import { resolveEnv, normalizeBaseUrl, getKeycloakToken } from "@/lib/keycloakUtils";

async function createOrFindKeycloakUser(token: string, firstName: string, lastName: string, email: string, password?: string) {
    const baseRaw = resolveEnv(
        "KEYCLOAK_BASE_URL",
        "KEYCLOAK_BASEURL",
        "KEYCLOAK_URL",
        "KEYCLOAK_HOST",
        "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
    );
    const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
    if (!baseRaw || !realm) {
        throw new Error("Missing KEYCLOAK_BASE_URL or KEYCLOAK_REALM for user creation");
    }
    const base = normalizeBaseUrl(baseRaw);
    const body: any = {
        username: email,
        email,
        firstName,
        lastName,
        enabled: true,
    };
    if (password) {
        body.credentials = [{ type: "password", value: password, temporary: false }];
    }
    const createRes = await fetch(`${base}/admin/realms/${realm}/users`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (createRes.status === 201) {
        const loc = createRes.headers.get("location") || "";
        const id = loc.split("/").pop() || null;
        if (!id) throw new Error("Kein Keycloak id in Location header");
        return id;
    }
    if (createRes.status === 409) {
        const findRes = await fetch(`${base}/admin/realms/${realm}/users?email=${encodeURIComponent(email)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!findRes.ok) {
            const txt = await findRes.text().catch(() => "");
            throw new Error(`Keycloak user search failed: ${findRes.status} ${txt}`);
        }
        const users = await findRes.json();
        if (Array.isArray(users) && users.length > 0 && users[0].id) {
            return users[0].id;
        }
        throw new Error("User exists but konnte nicht gefunden werden");
    }
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Keycloak create failed: ${createRes.status} ${txt}`);
}

export async function POST(req: Request) {
    // Berechtigungsprüfung: write_all für userAuth
    const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.write_all);
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für write_all auf userAuth" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { first_name, last_name, mail } = body;
        const interest = typeof body?.interest === 'boolean' ? Boolean(body.interest) : true; // Default: true

        if (!first_name || !last_name || !mail) {
            return NextResponse.json({ error: "Fehlende Felder" }, { status: 400 });
        }

        // Token holen
        const token = await getKeycloakToken();

        // Optional: generiere ein temporäres Passwort oder überlasse Keycloak das Setzen
        const tempPassword = Math.random().toString(36).slice(2, 12);

        // Keycloak-Account anlegen oder bestehendes holen
        const keycloakId = await createOrFindKeycloakUser(token, first_name, last_name, mail, tempPassword);

        // DB: Account anlegen (achte auf lowercase model names)
        const account = await prisma.account.create({
            data: {
                balance: 0,
                interest: interest,
                type: "user",
            },
        });

        const user = await prisma.user.create({
            data: {
                first_name,
                last_name,
                mail,
                keycloak_id: keycloakId,
                accountId: account.id,
            },
        });

        return NextResponse.json(user, { status: 201 });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Anlegen des Nutzers", detail: error?.message }, { status: 500 });
    }
}

export async function GET(req: Request) {
    // Berechtigungsprüfung: read_all für userAuth
    const perm = await checkPermission(req, ResourceType.userAuth, AuthorizationType.read_all);
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_all auf userAuth" }, { status: 403 });
    }

    try {
        const users = await prisma.user.findMany({
            where: { enabled: true },
            include: {
                account: {
                    select: { balance: true }
                }
            }
        });
        // Nur relevante Felder zurückgeben
        const result = users.map(u => ({
            id: u.id,
            first_name: u.first_name,
            last_name: u.last_name,
            mail: u.mail,
            balance: u.account?.balance ? Number(u.account.balance) : 0
        }));
        return NextResponse.json(result);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: "Fehler beim Laden der Nutzer", detail: error?.message }, { status: 500 });
    }
}
