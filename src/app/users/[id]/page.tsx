import React from "react";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { Transaction } from "@/app/types/transaction";
import TransactionTable from "@/app/components/TransactionTable";

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  // Serverseitiger Request mit Cookies + optionalem Bearer-Token
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");
  const apiUrl = `${proto}://${host}/api/users/${params.id}`;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");

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

  if (!res.ok) {
    return <div>Nutzer nicht gefunden</div>;
  }

  const data: { user: { id: number; first_name: string; last_name: string; mail: string; balance: number }, transactions: Transaction[] } = await res.json();
  const { user, transactions } = data;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Nutzer-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{user.first_name} {user.last_name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{user.mail}</div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{Number(user.balance).toFixed(2)} €</span></div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
      <TransactionTable transactions={transactions} />
    </div>
  );
}
