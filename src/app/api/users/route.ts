// typescript
// Datei: `src/app/api/users/route.ts`
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function resolveEnv(...keys: string[]) {
    for (const k of keys) {
        if (typeof process.env[k] === "string" && process.env[k]!.length > 0) return process.env[k]!;
    }
    return undefined;
}

async function getKeycloakToken() {
    // Versuche mehrere mögliche Env-Namen (häufige Varianten)
    const base = resolveEnv(
        "KEYCLOAK_BASE_URL",
        "KEYCLOAK_BASEURL",
        "KEYCLOAK_URL",
        "KEYCLOAK_HOST",
        "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
    );
    const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
    const clientId = resolveEnv("KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID");
    const clientSecret = resolveEnv("KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET_KEY");

    const tried = {
        base: ["KEYCLOAK_BASE_URL", "KEYCLOAK_BASEURL", "KEYCLOAK_URL", "KEYCLOAK_HOST", "NEXT_PUBLIC_KEYCLOAK_BASE_URL"],
        realm: ["KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM"],
        clientId: ["KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID"],
        clientSecret: ["KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET_KEY"],
    };

    const missingParts: string[] = [];
    if (!base) missingParts.push("KEYCLOAK_BASE_URL");
    if (!realm) missingParts.push("KEYCLOAK_REALM");
    if (!clientId) missingParts.push("KEYCLOAK_CLIENT_ID");
    if (!clientSecret) missingParts.push("KEYCLOAK_CLIENT_SECRET");

    if (missingParts.length > 0) {
        console.error("Missing Keycloak env vars:", missingParts.join(", "), "| presence map:", {
            base: tried.base.reduce((acc, k) => ({ ...acc, [k]: !!process.env[k] }), {}),
            realm: tried.realm.reduce((acc, k) => ({ ...acc, [k]: !!process.env[k] }), {}),
            clientId: tried.clientId.reduce((acc, k) => ({ ...acc, [k]: !!process.env[k] }), {}),
            clientSecret: tried.clientSecret.reduce((acc, k) => ({ ...acc, [k]: !!process.env[k] }), {}),
            NODE_ENV: process.env.NODE_ENV,
        });
        throw new Error(`Missing Keycloak env vars: ${missingParts.join(", ")} (checked multiple common keys)`);
    }

    const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", clientId!);
    params.append("client_secret", clientSecret!);

    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Keycloak token error: ${res.status} ${txt}`);
    }

    const json = await res.json();
    return json.access_token as string;
}

async function createOrFindKeycloakUser(token: string, firstName: string, lastName: string, email: string, password?: string) {
    const base = process.env.KEYCLOAK_BASE_URL!;
    const realm = process.env.KEYCLOAK_REALM!;

    // Versuch anlegen
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
        // Location: .../users/{id}
        const loc = createRes.headers.get("location") || "";
        const id = loc.split("/").pop() || null;
        if (!id) throw new Error("Kein Keycloak id in Location header");
        return id;
    }

    if (createRes.status === 409) {
        // Bereits vorhanden -> suche per Email
        const findRes = await fetch(`${base}/admin/realms/${realm}/users?email=${encodeURIComponent(email)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!findRes.ok) throw new Error(`Keycloak user search failed: ${findRes.status}`);
        const users = await findRes.json();
        if (Array.isArray(users) && users.length > 0 && users[0].id) {
            return users[0].id;
        }
        throw new Error("User exists but konnte nicht gefunden werden");
    }

    const txt = await createRes.text();
    throw new Error(`Keycloak create failed: ${createRes.status} ${txt}`);
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { first_name, last_name, mail } = body;

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
                interest: true,
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