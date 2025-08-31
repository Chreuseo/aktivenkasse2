// typescript
// Datei: `src/app/api/users/route.ts`
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { validateUserPermissions } from "@/services/authService";

function resolveEnv(...keys: string[]) {
    for (const k of keys) {
        if (typeof process.env[k] === "string" && process.env[k]!.length > 0) return process.env[k]!;
    }
    return undefined;
}

function normalizeBaseUrl(base: string) {
    return base.replace(/\/+$/, "");
}
// typescript
async function getKeycloakToken() {
    const baseRaw = resolveEnv(
        "KEYCLOAK_BASE_URL",
        "KEYCLOAK_BASEURL",
        "KEYCLOAK_URL",
        "KEYCLOAK_HOST",
        "NEXT_PUBLIC_KEYCLOAK_BASE_URL"
    );
    const realm = resolveEnv("KEYCLOAK_REALM", "KEYCLOAK_REALM_NAME", "NEXT_PUBLIC_KEYCLOAK_REALM");
    const clientId = resolveEnv("KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID");
    const clientSecret = resolveEnv("KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET_KEY");

    const missingParts: string[] = [];
    if (!baseRaw) missingParts.push("KEYCLOAK_BASE_URL");
    if (!realm) missingParts.push("KEYCLOAK_REALM");
    if (!clientId) missingParts.push("KEYCLOAK_CLIENT_ID");
    if (!clientSecret) missingParts.push("KEYCLOAK_CLIENT_SECRET");

    if (missingParts.length > 0) {
        console.error("Missing Keycloak env vars:", missingParts.join(", "));
        throw new Error(`Missing Keycloak env vars: ${missingParts.join(", ")}`);
    }

    const base = normalizeBaseUrl(baseRaw!);

    // Baue genau einen aktuellen Token-Endpunkt: /realms/{realm}/protocol/openid-connect/token
    // Falls die Base-URL bereits ein `/auth` enthält, bleibt das erhalten (es wird nicht zusätzlich `/auth` ergänzt).
    const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", clientId!);
    params.append("client_secret", clientSecret!);

    try {
        console.info("Attempting Keycloak token url:", tokenUrl);
        const res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            console.error("Keycloak token request failed", { url: tokenUrl, status: res.status, text: txt });
            throw new Error(`Keycloak token error: ${res.status} ${txt}`);
        }

        const json = await res.json();
        if (!json?.access_token) {
            throw new Error("No access_token in Keycloak response");
        }
        return json.access_token as string;
    } catch (err: any) {
        console.error("Keycloak token fetch error", { url: tokenUrl, message: err?.message ?? String(err) });
        throw err;
    }
}

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

async function checkPermission(req: Request, requiredPermission: AuthorizationType) {
    let jwt: any = undefined;
    let userId: any = undefined;
    let source = "none";
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
            const token = authHeader.slice(7);
            jwt = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
            userId = jwt.sub || jwt.id;
            source = "header";
        } catch {}
    }
    if (!jwt) {
        try {
            const body = await req.clone().json();
            if (body?.jwt) jwt = body.jwt;
            if (body?.userId) userId = body.userId;
            if (jwt && !userId) userId = jwt.sub || jwt.id;
            if (jwt) source = "body";
        } catch {}
    }
    if (!userId) {
        const cookieHeader = req.headers.get("cookie");
        if (cookieHeader) {
            const match = cookieHeader.match(/validated_user_keycloak_id=([^;]+)/);
            if (match) {
                userId = match[1];
                source = "cookie";
            }
        }
    }
    console.log("[checkPermission] userId:", userId, "jwt:", jwt, "source:", source);
    if (!userId || !jwt) {
        return { allowed: false, error: "Missing userId or jwt" };
    }
    // Berechtigungsprüfung direkt als Funktion
    const result = await validateUserPermissions({ userId, resource: ResourceType.userAuth, requiredPermission, jwt });
    return { allowed: result.allowed };
}

export async function POST(req: Request) {
    // Berechtigungsprüfung: write_all für userAuth
    const perm = await checkPermission(req, AuthorizationType.write_all);
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für write_all auf userAuth" }, { status: 403 });
    }

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

export async function GET(req: Request) {
    // Berechtigungsprüfung: read_all für userAuth
    const perm = await checkPermission(req, AuthorizationType.read_all);
    if (!perm.allowed) {
        return NextResponse.json({ error: "Keine Berechtigung für read_all auf userAuth" }, { status: 403 });
    }

    try {
        const users = await prisma.user.findMany({
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
