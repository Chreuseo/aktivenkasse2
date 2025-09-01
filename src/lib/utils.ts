import { IncomingMessage } from "http";

export function extractToken(session: any): string {
    return (session?.token as string)
        || (session?.user && typeof session.user === 'object' && (session.user as any).token)
        || "";
}

export async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(url, options);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Unbekannter Fehler');
    return json;
}
