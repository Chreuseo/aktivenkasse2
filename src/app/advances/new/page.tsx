import NewAdvanceForm from "./NewAdvanceForm";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";

export default async function NewAdvancePage() {
  // Serverseitiger Fetch auf Backend-API mit Auth-Header
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");
  const apiUrl = `${proto}://${host}/api/clearing-accounts`;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");

  // Access-Token aus NextAuth-Session holen
  const dummyReq = new Request(apiUrl, { headers: { cookie: cookieHeader } });
  const nxt = await getToken({ req: dummyReq as any, secret: process.env.NEXTAUTH_SECRET });
  const bearer = (nxt as any)?.accessToken || (nxt as any)?.token || null;

  const res = await fetch(apiUrl, {
    headers: {
      cookie: cookieHeader,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    cache: "no-store",
  });
  let accounts: { id: number; name: string }[] = [];
  if (res.ok) {
    const json = await res.json();
    accounts = (Array.isArray(json) ? json : []).map((a: any) => ({ id: a.id, name: a.name }));
  }
  return <NewAdvanceForm accounts={accounts} />;
}
