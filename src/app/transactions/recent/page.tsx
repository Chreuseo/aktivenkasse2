import React from "react";
import "@/app/css/tables.css";
import { Transaction } from "@/app/types/transaction";
import GeneralTransactionTable from "@/app/components/GeneralTransactionTable";
import { cookies, headers } from "next/headers";

export default async function RecentTransactionsPage() {
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host");
  const apiUrl = `${proto}://${host}/api/transactions/recent`;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");

  const res = await fetch(apiUrl, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });

  if (!res.ok) {
    return (
      <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
        <h2 style={{ marginBottom: "1rem" }}>Letzte 20 Buchungen (nach Erstellungsdatum)</h2>
        <p>Fehler beim Laden: {res.status} {res.statusText}</p>
      </div>
    );
  }

  const transactions: Transaction[] = await res.json();

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Letzte 20 Buchungen (nach Erstellungsdatum)</h2>
      <GeneralTransactionTable transactions={transactions} />
    </div>
  );
}
