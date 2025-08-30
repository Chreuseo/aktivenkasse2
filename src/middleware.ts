import { getSession } from 'next-auth/react';

export async function middleware(req) {
    const session = await getSession({ req });

    if (!session) {
        if (req.nextUrl.pathname.startsWith('/api')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        } else {
            return NextResponse.redirect(new URL('/login', req.url));
        }
    }

    return NextResponse.next();
}
