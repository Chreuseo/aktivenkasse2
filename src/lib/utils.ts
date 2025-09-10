export function extractToken(session: any): string {
    return (session?.token as string)
        || (session?.user && typeof session.user === 'object' && (session.user as any).token)
        || "";
}

export async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';

    let data: any = null;
    try {
        if (contentType.includes('application/json')) {
            data = await res.json();
        } else {
            const text = await res.text();
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = { message: text };
                }
            } else {
                data = null;
            }
        }
    } catch {
        // Fallback bei leeren Bodies oder Parserfehlern
        try {
            const text = await res.text();
            data = text ? { message: text } : null;
        } catch {
            data = null;
        }
    }

    if (!res.ok) {
        const message = (data && (data.error || data.message)) || res.statusText || 'Unbekannter Fehler';
        throw new Error(message);
    }

    return data;
}
